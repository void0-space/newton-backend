import { FastifyInstance } from 'fastify';
import { db } from '../db/drizzle';
import { webhook, webhookDelivery, whatsappSession } from '../db/schema';
import { eq, and, lt, gt } from 'drizzle-orm';
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
  private cleanupTask?: cron.ScheduledTask;

  // Webhook safeguards configuration
  private readonly RATE_LIMIT_PER_HOUR = 999999; // Max deliveries per org per hour
  private readonly CIRCUIT_BREAKER_THRESHOLD = 50; // Consecutive failures before disabling (high tolerance for critical webhooks)
  private readonly CIRCUIT_BREAKER_COOLDOWN_SECONDS = 900; // 15 minutes cooldown (was 1 hour)
  private readonly DEDUP_WINDOW_SECONDS = 60; // Deduplication window
  private readonly MAX_RETRIES = 3; // Reduced from 5 to 3

  constructor(fastify: FastifyInstance) {
    this.fastify = fastify;
    this.setupRetryTask();
    this.setupCleanupTask();
  }

  async sendWebhook(organizationId: string, event: string, data: any, sessionId?: string) {
    // CRITICAL: This method MUST return immediately to avoid blocking message processing
    // All logic runs in background via setImmediate
    setImmediate(async () => {
      try {
        const payload: WebhookPayload = {
          event,
          data,
          timestamp: new Date().toISOString(),
          organizationId,
          sessionId,
        };

        // Ultra-lightweight: Just queue the raw data for processing
        // All business logic (deduplication, webhook lookup, circuit breaker) happens in worker
        await this.fastify.webhookQueue.queueWebhook(
          { organizationId, event }, // Minimal config
          payload
        );
      } catch (error) {
        this.fastify.log.error(
          'Error queuing webhook: ' + (error instanceof Error ? error.message : String(error))
        );
      }
    });
  }

  private async deliverWebhook(webhookConfig: any, payload: WebhookPayload) {
    const deliveryId = createId();
    const payloadString = JSON.stringify(payload);

    try {
      this.fastify.log.info(
        `Starting webhook delivery ${deliveryId} to ${webhookConfig.url} (Event: ${payload.event})`
      );

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

      // ... (webhook type handling logic unchanged)
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
          responseBody: responseBody.slice(0, 200), // REDUCED from 1000 to 200 chars
          updatedAt: new Date(),
        })
        .where(eq(webhookDelivery.id, deliveryId));

      if (response.ok) {
        this.fastify.log.info(`✅ Webhook delivered: ${deliveryId} (${response.status})`);
        await this.resetCircuitBreaker(webhookConfig.id);
      } else {
        this.fastify.log.warn(
          `⚠️ Webhook returned error: ${deliveryId} (Status: ${response.status})`
        );
        await this.handleWebhookFailure(webhookConfig.id, deliveryId);
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

      await this.handleWebhookFailure(webhookConfig.id, deliveryId);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
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

      // REDUCED: Max 3 retry attempts (was 5)
      if (attempts > this.MAX_RETRIES) {
        this.fastify.log.warn(
          `Max retry attempts (${this.MAX_RETRIES}) reached for webhook delivery: ${deliveryId}`
        );
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

      this.fastify.log.info(
        `Scheduled retry ${attempts} for webhook delivery: ${deliveryId} at ${nextAttempt}`
      );
    } catch (error) {
      this.fastify.log.error(`Error scheduling retry for delivery ${deliveryId}:`, error);
    }
  }

  private generateSignature(payload: string, secret: string): string {
    return 'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');
  }

  private setupRetryTask() {
    // Run every 5 minutes to check for failed deliveries that need retry
    this.retryTask = cron.schedule(
      '*/30 * * * *',
      async () => {
        try {
          // OPTIMIZATION: Only query recent failed deliveries (last 24 hours)
          // This prevents querying the entire table every 30 minutes
          const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

          const failedDeliveries = await db
            .select()
            .from(webhookDelivery)
            .where(
              and(
                eq(webhookDelivery.status, 'failed'),
                lt(webhookDelivery.nextAttemptAt, new Date()),
                // Only retry deliveries from last 24 hours
                gt(webhookDelivery.createdAt, oneDayAgo)
              )
            )
            .limit(100); // Limit to 100 retries per run

          // Process retries in parallel to avoid blocking
          await Promise.allSettled(
            failedDeliveries.map(async delivery => {
              this.fastify.log.info(`Retrying webhook delivery: ${delivery.id}`);

              const [webhookConfig] = await db
                .select()
                .from(webhook)
                .where(eq(webhook.id, delivery.webhookId))
                .limit(1);

              if (webhookConfig && webhookConfig.active) {
                await this.attemptDelivery(delivery.id, webhookConfig, delivery.payload);
              }
            })
          );
        } catch (error) {
          this.fastify.log.error(
            'Error in webhook retry task: ' +
              (error instanceof Error ? error.message : String(error))
          );
        }
      },
      {
        scheduled: false, // Don't start immediately
      }
    );
  }

  private setupCleanupTask() {
    // Run every 12 hours to delete old webhook delivery records
    this.cleanupTask = cron.schedule(
      '0 */12 * * *',
      async () => {
        try {
          this.fastify.log.info('🧹 Running webhook delivery cleanup...');

          // Delete records older than 7 days
          const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

          const result = await db
            .delete(webhookDelivery)
            .where(lt(webhookDelivery.createdAt, sevenDaysAgo));

          this.fastify.log.info('✅ Webhook delivery cleanup completed');
        } catch (error) {
          this.fastify.log.error(
            'Error in webhook cleanup task: ' +
              (error instanceof Error ? error.message : String(error))
          );
        }
      },
      {
        scheduled: false, // Don't start immediately
      }
    );
  }

  startRetryTask() {
    if (this.retryTask) {
      this.retryTask.start();
      this.fastify.log.info('Webhook retry task started');
    }
    if (this.cleanupTask) {
      this.cleanupTask.start();
      this.fastify.log.info('Webhook cleanup task started');
    }
  }

  stopRetryTask() {
    if (this.retryTask) {
      this.retryTask.stop();
      this.fastify.log.info('Webhook retry task stopped');
    }
    if (this.cleanupTask) {
      this.cleanupTask.stop();
      this.fastify.log.info('Webhook cleanup task stopped');
    }
  }

  async cleanup() {
    this.stopRetryTask();
  }

  /**
   * Handle webhook failure - track consecutive failures and trigger circuit breaker
   */
  private async handleWebhookFailure(webhookId: string, deliveryId: string) {
    try {
      const failureKey = `webhook:failures:${webhookId}`;
      const failures = await this.fastify.redis.incr(failureKey);
      await this.fastify.redis.expire(failureKey, 3600); // Expire after 1 hour

      this.fastify.log.info(`Webhook ${webhookId} failure count: ${failures}`);

      // If we've hit the threshold, open the circuit breaker
      if (failures >= this.CIRCUIT_BREAKER_THRESHOLD) {
        const circuitKey = `webhook:circuit:${webhookId}`;
        await this.fastify.redis.setex(circuitKey, this.CIRCUIT_BREAKER_COOLDOWN_SECONDS, '1');

        this.fastify.log.error(
          `🚨 Circuit breaker OPENED for webhook ${webhookId} after ${failures} consecutive failures. ` +
            `Temporarily disabled for ${this.CIRCUIT_BREAKER_COOLDOWN_SECONDS / 60} minutes (auto-recovers).`
        );

        // DO NOT disable in database - let it auto-recover after cooldown
        // This prevents webhooks from getting stuck in disabled state
      } else {
        // Schedule retry if we haven't hit the circuit breaker
        await this.scheduleRetry(deliveryId);
      }
    } catch (error) {
      this.fastify.log.error(`Error handling webhook failure:`, error);
    }
  }

  /**
   * Reset circuit breaker failure counter on successful delivery
   */
  private async resetCircuitBreaker(webhookId: string) {
    try {
      const failureKey = `webhook:failures:${webhookId}`;
      await this.fastify.redis.del(failureKey);
    } catch (error) {
      this.fastify.log.error(`Error resetting circuit breaker:`, error);
    }
  }
}
