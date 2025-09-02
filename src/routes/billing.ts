import { FastifyPluginAsync } from 'fastify';
import {
  // Admin plan management
  createPlan,
  listPlans,
  getPlan,
  updatePlan,
  deactivatePlan,
  
  // Tenant subscription management
  createSubscription,
  getSubscription,
  activateSubscription,
  cancelSubscription,
  getUsage,
  getBillingHistory,
  
  // Webhook handler
  handleRazorpayWebhook,
} from '../controllers/billingController';

const billingRoutes: FastifyPluginAsync = async (fastify) => {
  // Webhook endpoint - no authentication required
  fastify.post('/webhook/razorpay', {
    config: {
      rateLimit: {
        max: 100,
        timeWindow: 60000, // 1 minute
      },
    },
  }, handleRazorpayWebhook);

  // Public plan listing (for pricing page)
  fastify.get('/plans', listPlans);
  fastify.get('/plans/:id', getPlan);

  // Admin-only plan management routes
  fastify.register(async function adminRoutes(fastify) {
    // Require admin authentication
    fastify.addHook('preHandler', async (request, reply) => {
      if (!request.user) {
        return reply.status(401).send({
          error: 'Authentication required',
          code: 'AUTH_REQUIRED',
        });
      }

      if (request.user.role !== 'admin') {
        return reply.status(403).send({
          error: 'Admin access required',
          code: 'ADMIN_REQUIRED',
        });
      }
    });

    fastify.post('/admin/plans', createPlan);
    fastify.put('/admin/plans/:id', updatePlan);
    fastify.delete('/admin/plans/:id', deactivatePlan);
  });

  // Tenant subscription routes
  fastify.register(async function tenantRoutes(fastify) {
    // Require API key or user authentication and organization
    fastify.addHook('preHandler', async (request, reply) => {
      const hasAuth = request.user || request.apiKey;
      if (!hasAuth) {
        return reply.status(401).send({
          error: 'Authentication required',
          code: 'AUTH_REQUIRED',
        });
      }

      if (!request.organization) {
        return reply.status(400).send({
          error: 'Organization context required',
          code: 'ORGANIZATION_REQUIRED',
        });
      }
    });

    // Subscription management
    fastify.post('/subscriptions', createSubscription);
    fastify.get('/subscriptions', getSubscription);
    fastify.post('/subscriptions/activate', activateSubscription);
    fastify.delete('/subscriptions', cancelSubscription);

    // Usage and billing
    fastify.get('/usage', getUsage);
    fastify.get('/billing-history', getBillingHistory);
  });
};

export default billingRoutes;