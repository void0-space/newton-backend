import { Worker, Job } from 'bullmq';
import { FastifyInstance } from 'fastify';
import { WebhookJobData } from '../services/webhookQueue';
import { createId } from '@paralleldrive/cuid2';
import IORedis from 'ioredis';
import { db } from '../db/drizzle';
import { webhookDelivery } from '../db/schema';
import { eq } from 'drizzle-orm';
import crypto from 'crypto';

export class WebhookWorker {
  private worker: Worker<WebhookJobData>;
  private fastify: FastifyInstance;

  constructor(fastify: FastifyInstance) {
    this.fastify = fastify;

    // Create BullMQ worker using Redis URL from Fastify config
    const redisConnection = this.fastify.config.REDIS_URL;
    const connection = new IORedis(redisConnection, { maxRetriesPerRequest: null });
    this.worker = new Worker<WebhookJobData>(
      'webhooks',
      async (job: Job<WebhookJobData>) => {
        return await this.processWebhook(job);
      },
      {
        connection,
        concurrency: 10, // Process up to 10 webhooks concurrently
      }
    );

    // Event handlers
    this.worker.on('completed', job => {
      this.fastify.log.info(`Webhook job ${job.id} completed successfully`);
    });

    this.worker.on('failed', (job, err) => {
      this.fastify.log.error(`Webhook job ${job?.id} failed:`, err);
    });

    this.worker.on('error', err => {
      this.fastify.log.error('Webhook worker error:', err);
    });

    this.fastify.log.info('Webhook worker started');
  }

  /**
   * Process a webhook job
   */
  private async processWebhook(job: Job<WebhookJobData>) {
    const { webhookConfig, payload } = job.data;
    const deliveryId = createId();
    const payloadString = JSON.stringify(payload);

    this.fastify.log.info(
      `Processing webhook job ${job.id} to ${webhookConfig.url} (Event: ${payload.event})`
    );

    try {
      // Save delivery record
      await db.insert(webhookDelivery).values({
        id: deliveryId,
        webhookId: webhookConfig.id,
        event: payload.event,
        payload: payloadString,
        status: 'pending',
        attempts: '0',
        nextAttemptAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await this.attemptDelivery(deliveryId, webhookConfig, payloadString);

      return {
        success: true,
        deliveryId,
        webhookId: webhookConfig.id,
        event: payload.event,
        status: 'completed',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.fastify.log.error(`Error processing webhook job ${job.id}:`, error);
      throw error; // BullMQ will handle retry
    }
  }

  private async attemptDelivery(deliveryId: string, webhookConfig: any, payloadString: string) {
    let controller: AbortController | null = null;
    let timeoutId: NodeJS.Timeout | null = null;

    try {
      const payload = JSON.parse(payloadString);
      const headers: Record<string, string> = {
        'User-Agent': 'WhatsApp-API-Webhook/1.0',
        'X-Webhook-Delivery': deliveryId,
        'X-Webhook-Event': payload.event,
      };

      let url = webhookConfig.url;
      let body: string | undefined = undefined;

      // Handle different webhook types (default to 'body' if not set)
      const webhookType = webhookConfig.type || 'body';

      if (webhookType === 'parameter') {
        // Send data as URL query parameters
        const params = new URLSearchParams();
        const data = payload.data as any;

        // Add platform and action
        params.append('platform', 'whatsapp');

        // Determine action based on event type
        let action = 'incoming';
        if (payload.event.includes('sent') || payload.event.includes('outbound')) {
          action = 'outgoing';
        }
        params.append('action', action);

        // Extract and normalize fields from nested structure
        if (data) {
          // From field - extract phone number without @s.whatsapp.net suffix
          if (data.from) {
            const fromPhone = data.from.split('@')[0];
            params.append('from', fromPhone);
          }

          // Message ID
          if (data.messageId) {
            params.append('message_id', data.messageId);
          }

          // Message text - extract from content.text
          if (data.content && data.content.text) {
            params.append('message', data.content.text);
          }

          // Timestamp - use content.timestamp if available (unix epoch)
          if (data.content && data.content.timestamp) {
            params.append('timestamp', String(data.content.timestamp));
          }

          // Add any other fields that aren't nested objects
          for (const [key, value] of Object.entries(data)) {
            if (
              key !== 'from' &&
              key !== 'messageId' &&
              key !== 'content' &&
              key !== 'timestamp' &&
              key !== 'sessionId' &&
              value !== null &&
              value !== undefined &&
              typeof value !== 'object'
            ) {
              params.append(key, String(value));
            }
          }
        }

        url = `${webhookConfig.url}?${params.toString()}`;
      } else {
        // Send data in request body (default behavior)
        headers['Content-Type'] = 'application/json';
        body = payloadString;
      }

      // Add signature if webhook has secret
      if (webhookConfig.secret) {
        const signature = this.generateSignature(payloadString, webhookConfig.secret);
        headers['X-Webhook-Signature'] = signature;
      }

      // Use AbortController for better compatibility and control
      controller = new AbortController();
      timeoutId = setTimeout(() => controller?.abort(), 30000); // 30 second timeout

      const response = await fetch(url, {
        method: 'POST',
        headers,
        ...(body && { body }),
        signal: controller.signal,
      });

      const responseBody = await response.text();

      // Update delivery record
      await db
        .update(webhookDelivery)
        .set({
          status: response.ok ? 'success' : 'failed',
          lastAttemptAt: new Date(),
          responseStatus: response.status.toString(),
          responseBody: responseBody.slice(0, 200),
          updatedAt: new Date(),
        })
        .where(eq(webhookDelivery.id, deliveryId));

      if (response.ok) {
        this.fastify.log.info(`✅ Webhook delivered: ${deliveryId} (${response.status})`);
      } else {
        this.fastify.log.warn(
          `⚠️ Webhook returned error: ${deliveryId} (Status: ${response.status})`
        );
        throw new Error(`Webhook returned status ${response.status}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.fastify.log.error(
        `❌ Webhook delivery FAILED: ${deliveryId} to ${webhookConfig.url}\nReason: ${errorMessage}`
      );

      // Update delivery record with error
      await db
        .update(webhookDelivery)
        .set({
          status: 'failed',
          lastAttemptAt: new Date(),
          responseStatus: 'error',
          responseBody: errorMessage.slice(0, 200),
          updatedAt: new Date(),
        })
        .where(eq(webhookDelivery.id, deliveryId));

      throw error;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  private generateSignature(payload: string, secret: string): string {
    return 'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');
  }

  /**
   * Close the worker
   */
  async close() {
    await this.worker.close();
    this.fastify.log.info('Webhook worker closed');
  }
}
