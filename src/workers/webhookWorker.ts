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
    const connection = new IORedis(redisConnection, { 
      maxRetriesPerRequest: null,
      lazyConnect: true,
      connectTimeout: 10000,
      retryDelayOnFailover: 100,
      enableReadyCheck: true
    });
    
    this.worker = new Worker<WebhookJobData>(
      'webhooks',
      async (job: Job<WebhookJobData>) => {
        return await this.processWebhook(job);
      },
      {
        connection,
        concurrency: 25, // Optimized concurrency to prevent resource saturation
        settings: {
          lockDuration: 30000, // 30 second lock duration for webhook deliveries
          maxStalledCount: 2, // Retry stalled jobs after 2 attempts
          stallInterval: 15000, // Check for stalled jobs every 15 seconds
        },
      }
    );

    // Event handlers
    this.worker.on('completed', job => {
      console.log(`Webhook job ${job.id} completed successfully`);
    });

    this.worker.on('failed', (job, err) => {
      console.error(`Webhook job ${job?.id} failed:`, err);
    });

    this.worker.on('error', err => {
      console.error('Webhook worker error:', err);
    });

    console.log('Webhook worker started');
  }

  /**
   * Process a webhook job
   */
  private async processWebhook(job: Job<WebhookJobData>) {
    const { webhookConfig, payload } = job.data;
    const { organizationId, event } = payload;

    console.log(
      `Processing webhook job ${job.id} for organization ${organizationId} (Event: ${event})`
    );

    try {
      // Handle case where we need to lookup webhooks (new ultra-lightweight format)
      if (!webhookConfig.id && webhookConfig.organizationId && webhookConfig.event) {
        return await this.processWebhookLookup(job);
      }

      // Existing processing for direct webhook config
      const deliveryId = createId();
      const payloadString = JSON.stringify(payload);

      // Save delivery record - optimized bulk insert
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

  private async processWebhookLookup(job: Job<WebhookJobData>) {
    const { webhookConfig, payload } = job.data;
    const { organizationId, event, data } = payload;

    // SAFEGUARD: Deduplication - check if we recently sent this exact webhook
    const dedupKey = `webhook:dedup:${organizationId}:${event}:${data.messageId || 'unknown'}`;
    const isDuplicate = await this.fastify.redis.get(dedupKey);

    if (isDuplicate) {
      this.fastify.log.info(
        `Skipping duplicate webhook for ${event} (messageId: ${data.messageId})`
      );
      return { success: true, message: 'Duplicate webhook skipped' };
    }

    // Get all active webhooks for the organization that listen to this event
    const webhooks = await db
      .select()
      .from(webhook)
      .where(and(eq(webhook.organizationId, organizationId), eq(webhook.active, true)));

    // Queue all webhooks for async processing (fire-and-forget)
    for (const webhookConfig of webhooks) {
      try {
        // Check if this webhook is configured for this event
        if (webhookConfig.events && !webhookConfig.events.includes(event)) {
          this.fastify.log.debug(
            `Webhook ${webhookConfig.id} not configured for event ${event}`
          );
          continue;
        }

        // SAFEGUARD: Circuit breaker - check if webhook is temporarily disabled
        const circuitKey = `webhook:circuit:${webhookConfig.id}`;
        const isCircuitOpen = await this.fastify.redis.get(circuitKey);

        if (isCircuitOpen) {
          this.fastify.log.warn(
            `Webhook ${webhookConfig.id} is circuit-broken, skipping delivery`
          );
          continue;
        }

        // Queue the webhook for delivery
        console.log(
          `Queuing webhook ${webhookConfig.id} for event ${event} to ${webhookConfig.url}`
        );
        const jobId = await this.fastify.webhookQueue.queueWebhook(webhookConfig, payload);
        console.log(`Webhook queued successfully with jobId: ${jobId}`);
      } catch (error) {
        this.fastify.log.error(
          `Error queuing webhook ${webhookConfig.id} for event ${event}:`,
          error
        );
      }
    }

    // Set deduplication key (expires after 60 seconds)
    await this.fastify.redis.setex(dedupKey, 60, '1');

    return { success: true, message: `Webhooks queued for event ${event}` };
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
      timeoutId = setTimeout(() => controller?.abort(), 8000); // 8 second timeout (reduced for faster failure)

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
