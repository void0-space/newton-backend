import { FastifyPluginCallback } from 'fastify';
import fp from 'fastify-plugin';

interface Metrics {
  requestCount: number;
  errorCount: number;
  queueSize: number;
  webhookCount: number;
  messageCount: number;
  responseTimes: number[];
  lastReset: number;
}

const enterpriseMetricsMiddleware: FastifyPluginCallback = (fastify, options, done) => {
  // Metrics storage
  const metrics: Metrics = {
    requestCount: 0,
    errorCount: 0,
    queueSize: 0,
    webhookCount: 0,
    messageCount: 0,
    responseTimes: [],
    lastReset: Date.now(),
  };

  // Reset metrics every minute
  const resetInterval = setInterval(() => {
    fastify.log.info('Resetting metrics');
    metrics.requestCount = 0;
    metrics.errorCount = 0;
    metrics.queueSize = 0;
    metrics.webhookCount = 0;
    metrics.messageCount = 0;
    metrics.responseTimes = [];
    metrics.lastReset = Date.now();
  }, 60 * 1000);

  // Decorate Fastify instance with metrics
  fastify.decorate('metrics', {
    incrementRequestCount: () => metrics.requestCount++,
    incrementErrorCount: () => metrics.errorCount++,
    incrementWebhookCount: () => metrics.webhookCount++,
    incrementMessageCount: () => metrics.messageCount++,
    addResponseTime: (time: number) => metrics.responseTimes.push(time),
    setQueueSize: (size: number) => metrics.queueSize = size,
    getMetrics: () => {
      const avgResponseTime = metrics.responseTimes.length > 0
        ? metrics.responseTimes.reduce((a, b) => a + b, 0) / metrics.responseTimes.length
        : 0;
      
      return {
        requestCount: metrics.requestCount,
        errorCount: metrics.errorCount,
        webhookCount: metrics.webhookCount,
        messageCount: metrics.messageCount,
        avgResponseTime: Math.round(avgResponseTime),
        queueSize: metrics.queueSize,
        lastReset: new Date(metrics.lastReset).toISOString(),
      };
    },
  });

  // Pre-handler hook to track requests
  fastify.addHook('preHandler', async (request) => {
    (request as any).startTime = Date.now();
    fastify.metrics.incrementRequestCount();
    
    // Track webhook and message requests specifically
    if (request.url.includes('/webhook') || request.url.includes('/webhooks')) {
      fastify.metrics.incrementWebhookCount();
    } else if (request.url.includes('/send')) {
      fastify.metrics.incrementMessageCount();
    }
  });

  // On response hook to track response times
  fastify.addHook('onResponse', async (request, reply) => {
    const startTime = (request as any).startTime;
    if (startTime) {
      const responseTime = Date.now() - startTime;
      fastify.metrics.addResponseTime(responseTime);
    }

    if (reply.statusCode >= 400) {
      fastify.metrics.incrementErrorCount();
    }
  });

  // Health endpoint with metrics
  fastify.get('/health', async (request, reply) => {
    const metricsData = fastify.metrics.getMetrics();
    return reply.send({
      status: 'ok',
      timestamp: new Date().toISOString(),
      metrics: metricsData,
    });
  });

  // Metrics endpoint
  fastify.get('/api/v1/metrics', async (request, reply) => {
    const metricsData = fastify.metrics.getMetrics();
    return reply.send({
      success: true,
      data: metricsData,
    });
  });

  // Detailed queue metrics endpoint
  fastify.get('/api/v1/queue/metrics', async (request, reply) => {
    try {
      // Get message queue metrics
      const messageQueue = fastify.messageQueue.getQueue();
      const messageQueueMetrics = await messageQueue.getJobCounts('completed', 'failed', 'waiting', 'active', 'delayed');
      
      // Get webhook queue metrics
      const webhookQueue = fastify.webhookQueue.getQueue();
      const webhookQueueMetrics = await webhookQueue.getJobCounts('completed', 'failed', 'waiting', 'active', 'delayed');
      
      return reply.send({
        success: true,
        data: {
          messageQueue: messageQueueMetrics,
          webhookQueue: webhookQueueMetrics,
        },
      });
    } catch (error) {
      fastify.log.error('Error getting queue metrics:', error);
      return reply.status(500).send({
        error: 'Failed to get queue metrics',
        code: 'QUEUE_METRICS_ERROR',
      });
    }
  });

  // Cleanup on server close
  fastify.addHook('onClose', async () => {
    clearInterval(resetInterval);
  });

  done();
};

export default fp(enterpriseMetricsMiddleware);
