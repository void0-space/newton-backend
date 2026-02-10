import { Queue } from 'bullmq';
import { FastifyInstance } from 'fastify';
import IORedis from 'ioredis';

export interface WebhookJobData {
  webhookConfig: any;
  payload: any;
}

export class WebhookQueueService {
  private queue: Queue<WebhookJobData>;
  private fastify: FastifyInstance;

  constructor(fastify: FastifyInstance) {
    this.fastify = fastify;

    // Create BullMQ queue using Redis URL from Fastify config
    const redisConnection = this.fastify.config.REDIS_URL;
    const connection = new IORedis(redisConnection, { maxRetriesPerRequest: null });
    this.queue = new Queue<WebhookJobData>('webhooks', {
      connection,
      defaultJobOptions: {
        attempts: 5, // Retry up to 5 times for enterprise reliability
        backoff: {
          type: 'exponential',
          delay: 3000, // Start with 3 second delay, doubles each retry (slower for enterprise)
        },
        removeOnComplete: {
          age: 3600, // Keep completed jobs for 1 hour (reduce storage)
          count: 10000, // Keep last 10,000 completed jobs
        },
        removeOnFail: {
          age: 604800, // Keep failed jobs for 7 days
        },
        timeout: 30000, // 30 second timeout per job
      },
    });

    this.fastify.log.info('Webhook queue service initialized');
  }

  /**
   * Add a webhook to the queue for async processing
   */
  async queueWebhook(webhookConfig: any, payload: any): Promise<string> {
    const job = await this.queue.add('deliver-webhook', {
      webhookConfig,
      payload,
    }, {
      jobId: `webhook-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    });

    this.fastify.log.info(`Webhook queued with job ID: ${job.id}`);
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
    this.fastify.log.info('Webhook queue service closed');
  }

  /**
   * Get the queue instance (for worker)
   */
  getQueue() {
    return this.queue;
  }
}
