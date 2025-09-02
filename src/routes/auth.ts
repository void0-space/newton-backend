import { FastifyPluginAsync } from 'fastify';
import { createApiKey, listApiKeys, revokeApiKey } from '../controllers/authController';

const authRoutes: FastifyPluginAsync = async (fastify) => {
  // API Key management routes (require authentication)
  fastify.post('/api-keys', {
    preHandler: async (request, reply) => {
      if (!request.user) {
        return reply.status(401).send({
          error: 'Authentication required',
          code: 'AUTH_REQUIRED',
        });
      }
    },
  }, createApiKey);

  fastify.get('/api-keys', {
    preHandler: async (request, reply) => {
      if (!request.user) {
        return reply.status(401).send({
          error: 'Authentication required',
          code: 'AUTH_REQUIRED',
        });
      }
    },
  }, listApiKeys);

  fastify.delete('/api-keys/:id', {
    preHandler: async (request, reply) => {
      if (!request.user) {
        return reply.status(401).send({
          error: 'Authentication required',
          code: 'AUTH_REQUIRED',
        });
      }
    },
  }, revokeApiKey);
};

export default authRoutes;