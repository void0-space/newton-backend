import { FastifyInstance } from 'fastify';
import {
  getCurrentUsage,
  getUsageAnalytics,
  checkFeatureLimit,
  incrementUsage,
} from '../controllers/usageController';

export async function usageRoutes(fastify: FastifyInstance) {
  // Get current usage for authenticated user's organization
  fastify.get('/current', getCurrentUsage);

  // Get usage analytics/history
  fastify.get('/analytics', getUsageAnalytics);

  // Check if feature can be used without incrementing
  fastify.post('/check-limit', checkFeatureLimit);

  // Manually increment usage (for admin or special cases)
  fastify.post('/increment', incrementUsage);
}

export default usageRoutes;