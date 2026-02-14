import { FastifyPluginCallback } from 'fastify';
import fp from 'fastify-plugin';

interface Metrics {
  requestCount: number;
  errorCount: number;
  queueSize: number;
  webhookCount: number;
  messageCount: number;
  responseTimes: number[];
  eventLoopDelays: number[];
  lastReset: number;
}

const enterpriseMetricsMiddleware: FastifyPluginCallback = (fastify, options, done) => {
  // Metrics storage - Redis-backed for persistence
  let metrics: Metrics = {
    requestCount: 0,
    errorCount: 0,
    queueSize: 0,
    webhookCount: 0,
    messageCount: 0,
    responseTimes: [],
    eventLoopDelays: [],
    lastReset: Date.now(),
  };

  // Redis keys for metrics storage
  const METRICS_KEY = 'metrics:current';
  const METRICS_HISTORY_KEY = 'metrics:history';
  const HISTORY_RETENTION = 24 * 60; // 24 hours of history (1-minute intervals)

  // Load metrics from Redis on startup
  const loadMetrics = async () => {
    try {
      const saved = await fastify.redis.get(METRICS_KEY);
      if (saved) {
        metrics = JSON.parse(saved);
        fastify.log.info('Loaded metrics from Redis');
      }
    } catch (error) {
      fastify.log.warn('Failed to load metrics from Redis:', error);
    }
  };

  // Save metrics to Redis periodically
  const saveMetrics = async () => {
    try {
      await fastify.redis.set(METRICS_KEY, JSON.stringify(metrics));
    } catch (error) {
      fastify.log.warn('Failed to save metrics to Redis:', error);
    }
  };

  // Initialize metrics
  loadMetrics();

  // Event loop monitor
  const eventLoopMonitor = setInterval(() => {
    const start = Date.now();
    setTimeout(() => {
      const delay = Date.now() - start;
      metrics.eventLoopDelays.push(delay);
    }, 0);
  }, 1000); // Check every second

  // Save metrics every 30 seconds
  const saveInterval = setInterval(() => {
    saveMetrics();
  }, 30 * 1000);

  // Reset metrics every minute and save to history
  const resetInterval = setInterval(async () => {
    fastify.log.info('Resetting metrics and saving to history');
    
    // Calculate current metrics
    const currentMetrics = fastify.metrics.getMetrics();
    
    // Save to history
    try {
      const history = await fastify.redis.lrange(METRICS_HISTORY_KEY, 0, HISTORY_RETENTION - 1);
      const historyData = history.map(h => JSON.parse(h));
      historyData.unshift({
        timestamp: new Date().toISOString(),
        ...currentMetrics
      });
      
      // Trim to retention
      const trimmedHistory = historyData.slice(0, HISTORY_RETENTION);
      await fastify.redis.del(METRICS_HISTORY_KEY);
      for (const entry of trimmedHistory) {
        await fastify.redis.rpush(METRICS_HISTORY_KEY, JSON.stringify(entry));
      }
      
      fastify.log.info(`Saved metrics to history. Total entries: ${trimmedHistory.length}`);
    } catch (error) {
      fastify.log.warn('Failed to save metrics history:', error);
    }

    // Reset metrics
    metrics = {
      requestCount: 0,
      errorCount: 0,
      queueSize: 0,
      webhookCount: 0,
      messageCount: 0,
      responseTimes: [],
      eventLoopDelays: [],
      lastReset: Date.now(),
    };
  }, 60 * 1000);

  // Decorate Fastify instance with metrics
  fastify.decorate('metrics', {
    incrementRequestCount: () => {
      metrics.requestCount++;
    },
    incrementErrorCount: () => {
      metrics.errorCount++;
    },
    incrementWebhookCount: () => {
      metrics.webhookCount++;
    },
    incrementMessageCount: () => {
      metrics.messageCount++;
    },
    addResponseTime: (time: number) => {
      metrics.responseTimes.push(time);
    },
    setQueueSize: (size: number) => {
      metrics.queueSize = size;
    },
    getMetrics: () => {
      const avgResponseTime = metrics.responseTimes.length > 0
        ? metrics.responseTimes.reduce((a, b) => a + b, 0) / metrics.responseTimes.length
        : 0;
      
      const avgEventLoopDelay = metrics.eventLoopDelays.length > 0
        ? metrics.eventLoopDelays.reduce((a, b) => a + b, 0) / metrics.eventLoopDelays.length
        : 0;
      
      const maxEventLoopDelay = metrics.eventLoopDelays.length > 0
        ? Math.max(...metrics.eventLoopDelays)
        : 0;
      
      return {
        requestCount: metrics.requestCount,
        errorCount: metrics.errorCount,
        webhookCount: metrics.webhookCount,
        messageCount: metrics.messageCount,
        avgResponseTime: Math.round(avgResponseTime),
        avgEventLoopDelay: Math.round(avgEventLoopDelay),
        maxEventLoopDelay,
        queueSize: metrics.queueSize,
        lastReset: new Date(metrics.lastReset).toISOString(),
      };
    },
    getHistory: async (minutes: number = 60) => {
      try {
        const history = await fastify.redis.lrange(METRICS_HISTORY_KEY, 0, minutes - 1);
        return history.map(h => JSON.parse(h));
      } catch (error) {
        fastify.log.error('Failed to get metrics history:', error);
        return [];
      }
    }
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

  // Metrics history endpoint
  fastify.get('/api/v1/metrics/history', async (request, reply) => {
    const minutes = parseInt(request.query.minutes as string || '60');
    const history = await fastify.metrics.getHistory(minutes);
    
    return reply.send({
      success: true,
      data: history,
      minutes,
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
      
      // Get DLQ metrics
      const messageDLQMetrics = await fastify.messageQueue.getDLQMetrics();
      const webhookDLQMetrics = await fastify.webhookQueue.getDLQMetrics();
      
      return reply.send({
        success: true,
        data: {
          messageQueue: messageQueueMetrics,
          webhookQueue: webhookQueueMetrics,
          messageDLQ: messageDLQMetrics,
          webhookDLQ: webhookDLQMetrics,
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
    clearInterval(eventLoopMonitor);
    clearInterval(saveInterval);
    await saveMetrics(); // Save final metrics before shutdown
  });

  done();
};

export default fp(enterpriseMetricsMiddleware);
