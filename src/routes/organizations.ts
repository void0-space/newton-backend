import { FastifyPluginAsync } from 'fastify';
import { 
  createOrganization, 
  getOrganization, 
  listUserOrganizations 
} from '../controllers/organizationController';

const organizationRoutes: FastifyPluginAsync = async (fastify) => {
  // All routes require authentication
  fastify.addHook('preHandler', async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({
        error: 'Authentication required',
        code: 'AUTH_REQUIRED',
      });
    }
  });

  fastify.post('/', createOrganization);
  fastify.get('/', listUserOrganizations);
  fastify.get('/:id', getOrganization);
};

export default organizationRoutes;