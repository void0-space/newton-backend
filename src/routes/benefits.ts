import { FastifyPluginAsync } from 'fastify';
import {
  listBenefits,
  getBenefit,
  createBenefit,
  updateBenefit,
  deleteBenefit,
} from '../controllers/benefitsController';
import { convertHeaders } from '../utils/header';
import { auth } from '../lib/auth';

const benefitsRoutes: FastifyPluginAsync = async (fastify) => {
  // Admin benefits management routes
  
  // Authentication prehandler for all admin routes
  const adminPrehandler = async (request, reply) => {
    const headers = convertHeaders(request);
    const session = await auth.api.getSession({ headers });
    if (!session?.session) {
      return reply.status(401).send({
        error: 'Authentication required',
        code: 'AUTH_REQUIRED',
      });
    }
    if (session.user.role !== 'admin') {
      return reply.status(403).send({
        error: 'Admin access required',
        code: 'ADMIN_REQUIRED',
      });
    }
  };
  
  // List all benefits
  fastify.get('/admin/benefits', {
    preHandler: adminPrehandler
  }, listBenefits);
  
  // Get a single benefit
  fastify.get('/admin/benefits/:id', {
    preHandler: adminPrehandler
  }, getBenefit);
  
  // Create a new benefit
  fastify.post('/admin/benefits', {
    preHandler: adminPrehandler,
    schema: {
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 100 },
          type: { type: 'string', enum: ['meter'] },
          meterId: { type: 'string' },
          creditedUnits: { type: 'integer', minimum: 0 },
          isActive: { type: 'boolean' }
        }
      }
    }
  }, createBenefit);
  
  // Update a benefit
  fastify.put('/admin/benefits/:id', {
    preHandler: adminPrehandler,
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string' }
        }
      },
      body: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 100 },
          type: { type: 'string', enum: ['meter'] },
          meterId: { type: 'string' },
          creditedUnits: { type: 'integer', minimum: 0 },
          isActive: { type: 'boolean' }
        }
      }
    }
  }, updateBenefit);
  
  // Delete a benefit
  fastify.delete('/admin/benefits/:id', {
    preHandler: adminPrehandler,
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string' }
        }
      }
    }
  }, deleteBenefit);
};

export default benefitsRoutes;