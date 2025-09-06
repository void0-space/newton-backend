import { FastifyPluginAsync, FastifyRequest } from 'fastify';
import {
  createCampaign,
  getCampaigns,
  getCampaign,
  updateCampaign,
  deleteCampaign,
  manageCampaign,
  getCampaignTemplates,
  createCampaignTemplate,
} from '../controllers/campaignController';
import { auth } from '../lib/auth';
import { convertHeaders } from '../utils/header';

const campaignRoutes: FastifyPluginAsync = async fastify => {
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
        name: 'Unknown',
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

  // Campaign CRUD routes
  fastify.post('/', { preHandler: sessionAuthMiddleware }, createCampaign);
  fastify.get('/', { preHandler: sessionAuthMiddleware }, getCampaigns);
  fastify.get('/:id', { preHandler: sessionAuthMiddleware }, getCampaign);
  fastify.put('/:id', { preHandler: sessionAuthMiddleware }, updateCampaign);
  fastify.delete('/:id', { preHandler: sessionAuthMiddleware }, deleteCampaign);

  // Campaign management routes
  fastify.post('/:id/actions', { preHandler: sessionAuthMiddleware }, manageCampaign);

  // Campaign template routes
  fastify.get('/templates', { preHandler: sessionAuthMiddleware }, getCampaignTemplates);
  fastify.post('/templates', { preHandler: sessionAuthMiddleware }, createCampaignTemplate);
};

export default campaignRoutes;