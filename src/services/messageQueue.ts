import { Queue } from 'bullmq';
import { FastifyInstance } from 'fastify';

export interface MessageJobData {
  organizationId: string;
  sessionId: string;
  to: string;
  messageContent: any;
  messageText?: string;
  caption?: string;
  type: 'text' | 'image' | 'video' | 'audio' | 'document';
}

export class MessageQueueService {
  private queue: Queue<MessageJobData>;
  private fastify: FastifyInstance;

  constructor(fastify: FastifyInstance) {
    this.fastify = fastify;

    // Create BullMQ queue using Redis URL from Fastify config
    // This ensures we use the same connection string as the rest of the app
    const redisConnection = this.fastify.config.REDIS_URL;

    this.queue = new Queue<MessageJobData>('whatsapp-messages', {
      connection: redisConnection,
      defaultJobOptions: {
        attempts: 3, // Retry up to 3 times
        backoff: {
          type: 'exponential',
          delay: 2000, // Start with 2 second delay, doubles each retry
        },
        removeOnComplete: {
          age: 86400, // Keep completed jobs for 24 hours
          count: 1000, // Keep last 1000 completed jobs
        },
        removeOnFail: {
          age: 604800, // Keep failed jobs for 7 days
        },
      },
    });

    this.fastify.log.info('Message queue service initialized');
  }

  /**
   * Add a message to the queue for async processing
   */
  async queueMessage(data: MessageJobData): Promise<string> {
    const job = await this.queue.add('send-message', data, {
      jobId: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    });

    this.fastify.log.info(`Message queued with job ID: ${job.id}`);
    return job.id!;
  }

  /**
   * Get job status by ID
   */
  async getJobStatus(jobId: string) {
    const job = await this.queue.getJob(jobId);

    if (!job) {
      return null;
    }

    const state = await job.getState();
    const progress = job.progress;
    const returnValue = job.returnvalue;
    const failedReason = job.failedReason;

    return {
      id: job.id,
      state, // 'waiting', 'active', 'completed', 'failed', 'delayed'
      progress,
      result: returnValue,
      error: failedReason,
      attemptsMade: job.attemptsMade,
      processedOn: job.processedOn,
      finishedOn: job.finishedOn,
      data: job.data,
    };
  }

  /**
   * Close the queue connection
   */
  async close() {
    await this.queue.close();
    this.fastify.log.info('Message queue service closed');
  }

  /**
   * Get the queue instance (for worker)
   */
  getQueue() {
    return this.queue;
  }
}
