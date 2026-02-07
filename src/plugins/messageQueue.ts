import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { MessageQueueService } from '../services/messageQueue';
import { MessageWorker } from '../workers/messageWorker';

declare module 'fastify' {
  interface FastifyInstance {
    messageQueue: MessageQueueService;
    messageWorker: MessageWorker;
  }
}

async function messageQueuePlugin(fastify: FastifyInstance) {
  // Initialize message queue service
  const messageQueue = new MessageQueueService(fastify);
  fastify.decorate('messageQueue', messageQueue);

  // Initialize message worker
  const messageWorker = new MessageWorker(fastify);
  fastify.decorate('messageWorker', messageWorker);

  // Graceful shutdown
  fastify.addHook('onClose', async () => {
    fastify.log.info('Closing message queue and worker...');
    await messageWorker.close();
    await messageQueue.close();
  });

  fastify.log.info('Message queue plugin registered');
}

export default fp(messageQueuePlugin, {
  name: 'message-queue',
  dependencies: ['baileys-plugin', '@fastify/redis'],
});
