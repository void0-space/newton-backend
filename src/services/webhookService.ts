import { FastifyInstance } from 'fastify';
import { db } from '../db/drizzle';
import { webhook, webhookDelivery, whatsappSession } from '../db/schema';
import { eq, and, lt } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import crypto from 'crypto';
import cron from 'node-cron';

export interface WebhookPayload {
  event: string;
  data: any;
  timestamp: string;
  organizationId: string;
  sessionId?: string;
}

export class WebhookService {
  private fastify: FastifyInstance;
  private retryTask?: cron.ScheduledTask;

  constructor(fastify: FastifyInstance) {
    this.fastify = fastify;
    this.setupRetryTask();
  }

  async sendWebhook(organizationId: string, event: string, data: any, sessionId?: string) {
    try {
      // Get all active webhooks for the organization that listen to this event
      const webhooks = await db
        .select()
        .from(webhook)
        .where(and(
          eq(webhook.organizationId, organizationId),
          eq(webhook.active, true)
        ));

      const payload: WebhookPayload = {
        event,
        data,
        timestamp: new Date().toISOString(),
        organizationId,
        sessionId,
      };

      for (const webhookConfig of webhooks) {
        // Check if this webhook is configured for this event
        if (webhookConfig.events && !webhookConfig.events.includes(event)) {
          continue;
        }

        await this.deliverWebhook(webhookConfig, payload);
      }
    } catch (error) {
      this.fastify.log.error('Error sending webhook: ' + (error instanceof Error ? error.message : String(error)));
    }
  }

  private async deliverWebhook(webhookConfig: any, payload: WebhookPayload) {
    const deliveryId = createId();
    const payloadString = JSON.stringify(payload);

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
    } catch (error) {
      this.fastify.log.error(`Error creating webhook delivery ${deliveryId}:`, error);
    }
  }

  private async attemptDelivery(deliveryId: string, webhookConfig: any, payloadString: string) {
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

      this.fastify.log.info(`Webhook type: ${webhookType}, webhook config type: ${webhookConfig.type}`);

      if (webhookType === 'parameter') {
        // Send data as URL query parameters
        const params = new URLSearchParams();
        const data = payload.data as any;

        // Add platform and action
        params.append('platform', 'whatsapp');
        params.append('action', payload.event.split('.')[1] || payload.event);

        // Extract and normalize fields from nested structure
        if (data) {
          // From field - extract phone number without @s.whatsapp.net suffix
          if (data.from) {
            const fromPhone = data.from.split('@')[0];
            params.append('from', fromPhone);
          }

          // To field - get account phone number from session
          if (payload.sessionId) {
            try {
              const [session] = await db
                .select()
                .from(whatsappSession)
                .where(eq(whatsappSession.id, payload.sessionId))
                .limit(1);

              if (session && session.phoneNumber) {
                params.append('to', session.phoneNumber);
              }
            } catch (error) {
              this.fastify.log.error(`Error fetching session for webhook: ${error}`);
            }
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
            if (key !== 'from' && key !== 'messageId' && key !== 'content' && key !== 'timestamp' &&
                value !== null && value !== undefined && typeof value !== 'object') {
              params.append(key, String(value));
            }
          }
        }

        url = `${webhookConfig.url}?${params.toString()}`;

        // Log for debugging
        this.fastify.log.info(`Webhook Parameter Mode - URL: ${url}`);
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

      const response = await fetch(url, {
        method: 'POST',
        headers,
        ...(body && { body }),
        signal: AbortSignal.timeout(30000), // 30 second timeout
      });

      const responseBody = await response.text();

      // Update delivery record
      await db
        .update(webhookDelivery)
        .set({
          status: response.ok ? 'success' : 'failed',
          lastAttemptAt: new Date(),
          responseStatus: response.status.toString(),
          responseBody: responseBody.slice(0, 1000), // Limit response body size
          updatedAt: new Date(),
        })
        .where(eq(webhookDelivery.id, deliveryId));

      if (response.ok) {
        this.fastify.log.info(`Webhook delivered successfully: ${deliveryId}`);
      } else {
        this.fastify.log.warn(`Webhook delivery failed: ${deliveryId}, status: ${response.status}`);
        await this.scheduleRetry(deliveryId);
      }
    } catch (error) {
      this.fastify.log.error(`Webhook delivery error: ${deliveryId}`, error);
      
      // Update delivery record with error
      await db
        .update(webhookDelivery)
        .set({
          status: 'failed',
          lastAttemptAt: new Date(),
          responseStatus: 'error',
          responseBody: error instanceof Error ? error.message : 'Unknown error',
          updatedAt: new Date(),
        })
        .where(eq(webhookDelivery.id, deliveryId));

      await this.scheduleRetry(deliveryId);
    }
  }

  private async scheduleRetry(deliveryId: string) {
    try {
      const [delivery] = await db
        .select()
        .from(webhookDelivery)
        .where(eq(webhookDelivery.id, deliveryId))
        .limit(1);

      if (!delivery) return;

      const attempts = parseInt(delivery.attempts) + 1;
      
      // Max 5 retry attempts
      if (attempts > 5) {
        this.fastify.log.warn(`Max retry attempts reached for webhook delivery: ${deliveryId}`);
        return;
      }

      // Exponential backoff: 1min, 5min, 25min, 2hrs, 12hrs
      const backoffMinutes = Math.pow(5, attempts - 1);
      const nextAttempt = new Date(Date.now() + backoffMinutes * 60 * 1000);

      await db
        .update(webhookDelivery)
        .set({
          attempts: attempts.toString(),
          nextAttemptAt: nextAttempt,
          updatedAt: new Date(),
        })
        .where(eq(webhookDelivery.id, deliveryId));

      this.fastify.log.info(`Scheduled retry ${attempts} for webhook delivery: ${deliveryId} at ${nextAttempt}`);
    } catch (error) {
      this.fastify.log.error(`Error scheduling retry for delivery ${deliveryId}:`, error);
    }
  }

  private generateSignature(payload: string, secret: string): string {
    return 'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');
  }

  private setupRetryTask() {
    // Run every 5 minutes to check for failed deliveries that need retry
    this.retryTask = cron.schedule('*/5 * * * *', async () => {
      try {
        const failedDeliveries = await db
          .select()
          .from(webhookDelivery)
          .where(and(
            eq(webhookDelivery.status, 'failed'),
            lt(webhookDelivery.nextAttemptAt, new Date())
          ));

        for (const delivery of failedDeliveries) {
          this.fastify.log.info(`Retrying webhook delivery: ${delivery.id}`);
          
          const [webhookConfig] = await db
            .select()
            .from(webhook)
            .where(eq(webhook.id, delivery.webhookId))
            .limit(1);

          if (webhookConfig && webhookConfig.active) {
            await this.attemptDelivery(delivery.id, webhookConfig, delivery.payload);
          }
        }
      } catch (error) {
        this.fastify.log.error('Error in webhook retry task: ' + (error instanceof Error ? error.message : String(error)));
      }
    }, {
      scheduled: false, // Don't start immediately
    });
  }

  startRetryTask() {
    if (this.retryTask) {
      this.retryTask.start();
      this.fastify.log.info('Webhook retry task started');
    }
  }

  stopRetryTask() {
    if (this.retryTask) {
      this.retryTask.stop();
      this.fastify.log.info('Webhook retry task stopped');
    }
  }

  async cleanup() {
    this.stopRetryTask();
  }
}