import fp from 'fastify-plugin';
import { FastifyInstance } from 'fastify';
import { WebhookQueueService } from '../services/webhookQueue';
import { WebhookWorker } from '../workers/webhookWorker';

const webhookQueuePlugin = fp(async (fastify: FastifyInstance) => {
  // Create webhook queue service
  const webhookQueue = new WebhookQueueService(fastify);
  
  // Create webhook worker
  const webhookWorker = new WebhookWorker(fastify);

  // Decorate Fastify instance with webhook queue
  fastify.decorate('webhookQueue', webhookQueue);

  // Handle server shutdown
  fastify.addHook('onClose', async (instance) => {
    fastify.log.info('Closing webhook queue and worker...');
    await webhookQueue.close();
    await webhookWorker.close();
  });

  fastify.log.info('Webhook queue plugin registered');
});

export default webhookQueuePlugin;
