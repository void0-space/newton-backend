import { Worker, Job } from 'bullmq';
import { FastifyInstance } from 'fastify';
import { MessageJobData } from '../services/messageQueue';
import { createId } from '@paralleldrive/cuid2';
import IORedis from 'ioredis';

export class MessageWorker {
  private worker: Worker<MessageJobData>;
  private fastify: FastifyInstance;

  constructor(fastify: FastifyInstance) {
    this.fastify = fastify;

    // Create BullMQ worker using Redis URL from Fastify config
    const redisConnection = this.fastify.config.REDIS_URL;
    const connection = new IORedis(redisConnection, { maxRetriesPerRequest: null });
     this.worker = new Worker<MessageJobData>(
      'whatsapp-messages',
      async (job: Job<MessageJobData>) => {
        return await this.processMessage(job);
      },
      {
        connection,
        concurrency: 100, // Process up to 100 messages concurrently (significantly increased for high load)
        settings: {
          // Process jobs in priority order (higher priority first)
          lockDuration: 30000, // 30 second lock duration
          maxStalledCount: 1, // Retry stalled jobs immediately
        },
      }
    );

    // Event handlers
    this.worker.on('completed', job => {
      this.fastify.log.info(`Job ${job.id} completed successfully`);
    });

    this.worker.on('failed', (job, err) => {
      this.fastify.log.error(`Job ${job?.id} failed:`, err);
    });

    this.worker.on('error', err => {
      this.fastify.log.error('Worker error:', err);
    });

    this.fastify.log.info('Message worker started');
  }

  /**
   * Process a message job
   */
  private async processMessage(job: Job<MessageJobData>) {
    const { organizationId, sessionId, to, messageContent, messageText, caption, type } = job.data;

    this.fastify.log.info(`Processing message job ${job.id} for ${to}`);

    try {
      // Get session from BaileysManager
      const sessionKey = `${organizationId}:${sessionId}`;
      const session = this.fastify.baileys.sessions.get(sessionKey);

      if (!session || !session.socket) {
        throw new Error(`Session ${sessionId} not found or not connected`);
      }

      // Update job progress
      await job.updateProgress(50);

      // Send message via Baileys
      const result = await session.socket.sendMessage(to, messageContent);

      this.fastify.log.info(`Message sent successfully via job ${job.id}`);

      // Update job progress
      await job.updateProgress(75);

      // Save to database
      const messageId = createId();
      await this.fastify.baileys.saveOutgoingMessage(
        organizationId,
        sessionId,
        messageId,
        to,
        messageText || caption || 'media',
        result
      );

      // Update job progress
      await job.updateProgress(100);

      // Return result
      return {
        success: true,
        messageId: result?.key?.id,
        status: result?.status || 'sent',
        to,
        sessionId,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.fastify.log.error(`Error processing message job ${job.id}:`, error);
      throw error; // BullMQ will handle retry
    }
  }

  /**
   * Close the worker
   */
  async close() {
    await this.worker.close();
    this.fastify.log.info('Message worker closed');
  }
}
