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
    const connection = new IORedis(redisConnection, { 
      maxRetriesPerRequest: null,
      lazyConnect: true,
      connectTimeout: 10000,
      retryDelayOnFailover: 100,
      enableReadyCheck: true
    });
    
     this.worker = new Worker<MessageJobData>(
       'whatsapp-messages',
       async (job: Job<MessageJobData>) => {
         return await this.processMessage(job);
       },
       {
         connection,
         concurrency: 5, // Reduced concurrency to prevent resource saturation
         settings: {
           // Process jobs in priority order (higher priority first)
           lockDuration: 60000, // 60 second lock duration for long-running jobs
           maxStalledCount: 2, // Retry stalled jobs after 2 attempts
           stallInterval: 30000, // Check for stalled jobs every 30 seconds
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

    console.log(`Processing message job ${job.id} for ${to}`);

    try {
      // Get session from BaileysManager - use fast lookup
      const sessionKey = `${organizationId}:${sessionId}`;
      const session = this.fastify.baileys.sessions.get(sessionKey);

      if (!session || !session.socket) {
        throw new Error(`Session ${sessionId} not found or not connected`);
      }

      // Update job progress
      await job.updateProgress(50);

      // Send message via Baileys - optimized fire-and-forget
      const result = await session.socket.sendMessage(to, messageContent);

      console.log(`Message sent successfully via job ${job.id}`);

      // Update job progress
      await job.updateProgress(75);

      // Save to database - use connection pool optimized query
      const messageId = createId();
      await Promise.all([
        this.fastify.baileys.saveOutgoingMessage(
          organizationId,
          sessionId,
          messageId,
          to,
          messageText || caption || 'media',
          result
        ),
        job.updateProgress(100)
      ]);

      // Return result - minimize response size
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
