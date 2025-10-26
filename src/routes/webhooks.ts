import { FastifyPluginAsync } from 'fastify';
import {
  createWebhook,
  getWebhooks,
  getWebhook,
  updateWebhook,
  deleteWebhook,
  getWebhookDeliveries,
  testWebhook,
  getWebhookEvents,
} from '../controllers/webhookController';

const webhookRoutes: FastifyPluginAsync = async (fastify, options) => {
  // Get available events
  fastify.get('/events', {
    handler: getWebhookEvents,
  });

  // CRUD routes
  fastify.get('/', {
    handler: getWebhooks,
  });

  fastify.post('/', {
    handler: createWebhook,
  });

  fastify.get('/:id', {
    handler: getWebhook,
  });

  fastify.put('/:id', {
    handler: updateWebhook,
  });

  fastify.delete('/:id', {
    handler: deleteWebhook,
  });

  // Webhook deliveries
  fastify.get('/:id/deliveries', {
    handler: getWebhookDeliveries,
  });

  // Test webhook
  fastify.post('/:id/test', {
    handler: testWebhook,
  });
};

export default webhookRoutes;
