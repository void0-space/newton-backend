import { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { BillingService } from '../services/billingService';

const billingPlugin: FastifyPluginAsync = async fastify => {
  // Initialize billing service
  const billingService = new BillingService(fastify);
  fastify.decorate('billing', billingService);

  // Add usage tracking decorator
  fastify.decorateRequest('trackUsage', undefined);

  fastify.addHook('preHandler', async request => {
    if (request.organization) {
      request.trackUsage = async (
        type: 'messages_sent' | 'messages_received' | 'media_sent' | 'storage_used',
        amount: number = 1
      ) => {
        await billingService.trackUsage(request.organization!.id, type, amount);
      };
    }
  });

  // Add quota checking decorator
  fastify.decorate(
    'checkQuota',
    async (organizationId: string, type: 'messages' | 'sessions' | 'storage') => {
      return await billingService.checkUsageQuota(organizationId, type);
    }
  );

  // Add quota enforcement hook for message sending
  fastify.addHook('preHandler', async (request, reply) => {
    // Only check quota for message sending endpoints
    if (!request.url.includes('/messages/send') || !request.organization) {
      return;
    }

    const quota = await billingService.checkUsageQuota(request.organization.id, 'messages');

    if (!quota.allowed) {
      return reply.status(429).send({
        error: 'Message quota exceeded',
        code: 'QUOTA_EXCEEDED',
        data: {
          current: quota.current,
          limit: quota.limit,
          percentage: quota.percentage,
        },
      });
    }

    // Warn when approaching quota (80% or higher)
    if (quota.percentage >= 80) {
      reply.header('X-Quota-Warning', `${quota.percentage.toFixed(1)}% of quota used`);
      reply.header('X-Quota-Remaining', (quota.limit - quota.current).toString());
    }
  });

  fastify.log.info('Billing plugin initialized with Razorpay integration');
};

declare module 'fastify' {
  interface FastifyInstance {
    billing: BillingService;
    checkQuota(
      organizationId: string,
      type: 'messages' | 'sessions' | 'storage'
    ): Promise<{
      allowed: boolean;
      current: number;
      limit: number;
      percentage: number;
    }>;
  }

  interface FastifyRequest {
    trackUsage?: (
      type: 'messages_sent' | 'messages_received' | 'media_sent' | 'storage_used',
      amount?: number
    ) => Promise<void>;
  }
}

export default fp(billingPlugin, {
  name: 'billing-plugin',
});
