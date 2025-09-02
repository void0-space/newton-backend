import { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { BaileysManager } from '../services/baileysService';
import cron from 'node-cron';

const baileysPlugin: FastifyPluginAsync = async (fastify) => {
  // Create Baileys manager instance
  const baileys = new BaileysManager(fastify);
  
  // Register as a decorator so it's available in routes
  fastify.decorate('baileys', baileys);

  // Set up cleanup on app close
  fastify.addHook('onClose', async () => {
    await baileys.cleanup();
  });

  // Set up periodic cleanup of old sessions (every hour)
  const cleanupTask = cron.schedule('0 * * * *', async () => {
    try {
      fastify.log.info('Running session cleanup...');
      // Add cleanup logic here if needed
      // For now, we'll just log
    } catch (error) {
      fastify.log.error('Error during session cleanup: ' + (error instanceof Error ? error.message : String(error)));
    }
  }, {
    scheduled: false, // Don't start immediately
  });

  // Start cleanup task after fastify is ready
  fastify.addHook('onReady', async () => {
    cleanupTask.start();
    baileys.startWebhookRetryTask();
    fastify.log.info('Baileys manager initialized and cleanup task started');
  });

  // Subscribe to Redis events for cross-instance communication
  fastify.addHook('onReady', async () => {
    const subscriber = fastify.redis.duplicate();
    
    subscriber.psubscribe('whatsapp:session:*', (err, count) => {
      if (err) {
        fastify.log.error('Failed to subscribe to WhatsApp events: ' + (err instanceof Error ? err.message : String(err)));
      } else {
        fastify.log.info(`Subscribed to ${count} WhatsApp event channels`);
      }
    });

    subscriber.on('pmessage', (pattern, channel, message) => {
      try {
        const eventData = JSON.parse(message);
        const sessionId = channel.split(':')[2];
        
        fastify.log.debug(`Received event for session ${sessionId}:`, eventData);
        
        // Handle cross-instance events here
        // For now, we'll just log them
      } catch (error) {
        fastify.log.error('Error processing WhatsApp event: ' + (error instanceof Error ? error.message : String(error)));
      }
    });

    // Store subscriber for cleanup
    fastify.decorate('whatsappSubscriber', subscriber);
  });

  // Cleanup Redis subscriber
  fastify.addHook('onClose', async () => {
    if (fastify.whatsappSubscriber) {
      await fastify.whatsappSubscriber.quit();
    }
    cleanupTask.stop();
  });
};

declare module 'fastify' {
  interface FastifyInstance {
    baileys: BaileysManager;
    whatsappSubscriber?: any;
  }
}

export default fp(baileysPlugin, {
  name: 'baileys-plugin',
  dependencies: ['@fastify/redis'],
});