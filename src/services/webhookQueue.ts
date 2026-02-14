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
        removeOnFail: false, // Keep failed jobs permanently for DLQ processing
        timeout: 30000, // 30 second timeout per job
      },
    });

    // Create Dead-Letter Queue (DLQ) for failed webhooks
    this.dlq = new Queue<WebhookJobData & { error: string; stack: string; failedAt: Date }>(
      'webhooks-dlq',
      {
        connection,
        defaultJobOptions: {
          attempts: 1,
          removeOnComplete: false,
          removeOnFail: false,
        },
      }
    );

    // Setup failed job listener to move to DLQ
    this.queue.on('failed', async (job, error) => {
      console.log(`Webhook job ${job.id} failed, moving to DLQ:`, error.message);
      await this.dlq.add('failed-webhook', {
        ...job.data,
        error: error.message,
        stack: error.stack || '',
        failedAt: new Date(),
      });
    });

    this.fastify.log.info('Webhook queue service initialized');
  }

  /**
   * Add a webhook to the queue for async processing
   */
  async queueWebhook(webhookConfig: any, payload: any): Promise<string> {
    console.log('Queueing webhook:', webhookConfig, JSON.stringify(payload));
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
   * Get DLQ (Dead-Letter Queue) metrics
   */
  async getDLQMetrics() {
    try {
      const dlqMetrics = await this.dlq.getJobCounts('completed', 'failed', 'waiting', 'active', 'delayed');
      return dlqMetrics;
    } catch (error) {
      this.fastify.log.error('Error getting DLQ metrics:', error);
      return null;
    }
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
