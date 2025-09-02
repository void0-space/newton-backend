import { FastifyPluginAsync, FastifyRequest } from 'fastify';
import {
  createScheduledMessage,
  getScheduledMessages,
  getScheduledMessage,
  updateScheduledMessage,
  deleteScheduledMessage,
} from '../controllers/scheduledController';
import { auth } from '../lib/auth';
import { convertHeaders } from '../utils/header';

const scheduledRoutes: FastifyPluginAsync = async fastify => {
  // Session-based authentication middleware
  const sessionAuthMiddleware = async (request: FastifyRequest, reply: any) => {
    try {
      const headers = convertHeaders(request);
      const session = await auth.api.getSession({ headers });

      if (!session?.session) {
        return reply.status(401).send({
          error: 'Authentication required',
          code: 'AUTH_REQUIRED',
        });
      }

      if (!session?.session.activeOrganizationId) {
        return reply.status(400).send({
          error: 'User must be associated with an organization',
          code: 'NO_ORGANIZATION',
        });
      }

      // Set organization context for the request
      (request as any).organization = {
        id: session.session.activeOrganizationId,
        name: 'Unknown', // TODO: Get organization name from database using activeOrganizationId
      };
    } catch (error) {
      request.log.error(
        'Error in session auth middleware: ' +
          (error instanceof Error ? error.message : String(error))
      );
      return reply.status(500).send({
        error: 'Authentication error',
        code: 'AUTH_ERROR',
      });
    }
  };

  // CRUD routes
  fastify.post('/', { preHandler: sessionAuthMiddleware }, createScheduledMessage);
  fastify.get('/', { preHandler: sessionAuthMiddleware }, getScheduledMessages);
  fastify.get('/:id', { preHandler: sessionAuthMiddleware }, getScheduledMessage);
  fastify.put('/:id', { preHandler: sessionAuthMiddleware }, updateScheduledMessage);
  fastify.delete('/:id', { preHandler: sessionAuthMiddleware }, deleteScheduledMessage);
};

export default scheduledRoutes;
