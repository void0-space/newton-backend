import { FastifyPluginAsync, FastifyRequest } from 'fastify';
import {
  createContact,
  getContacts,
  getContact,
  updateContact,
  deleteContact,
  importContacts,
  exportContacts,
} from '../controllers/contactsController';
import { auth } from '../lib/auth';
import { convertHeaders } from '../utils/header';

const contactsRoutes: FastifyPluginAsync = async fastify => {
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
  fastify.post('/', { preHandler: sessionAuthMiddleware }, createContact);
  fastify.get('/', { preHandler: sessionAuthMiddleware }, getContacts);
  fastify.get('/:id', { preHandler: sessionAuthMiddleware }, getContact);
  fastify.put('/:id', { preHandler: sessionAuthMiddleware }, updateContact);
  fastify.delete('/:id', { preHandler: sessionAuthMiddleware }, deleteContact);

  // Import/Export routes
  fastify.post('/import', { preHandler: sessionAuthMiddleware }, importContacts);
  fastify.get('/export', { preHandler: sessionAuthMiddleware }, exportContacts);

  // Note: WhatsApp contacts and groups are now automatically synced via socket events
};

export default contactsRoutes;
