import { FastifyPluginAsync } from 'fastify';
import {
  listMeters,
  getMeter,
  createMeter,
  updateMeter,
  deleteMeter,
} from '../controllers/metersController';
import { convertHeaders } from '../utils/header';
import { auth } from '../lib/auth';

const metersRoutes: FastifyPluginAsync = async (fastify) => {
  // Admin meters management routes
  
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
  
  // List all meters
  fastify.get('/admin/meters', {
    preHandler: adminPrehandler
  }, listMeters);
  
  // Get a single meter
  fastify.get('/admin/meters/:id', {
    preHandler: adminPrehandler
  }, getMeter);
  
  // Create a new meter
  fastify.post('/admin/meters', {
    preHandler: adminPrehandler,
    schema: {
      body: {
        type: 'object',
        required: ['name', 'filters'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 100 },
          filters: { type: 'object' },
          aggregation: { type: 'string', enum: ['count', 'sum', 'average', 'minimum', 'maximum', 'unique'] },
          isActive: { type: 'boolean' }
        }
      }
    }
  }, createMeter);
  
  // Update a meter
  fastify.put('/admin/meters/:id', {
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
          filters: { type: 'object' },
          aggregation: { type: 'string', enum: ['count', 'sum', 'average', 'minimum', 'maximum', 'unique'] },
          isActive: { type: 'boolean' }
        }
      }
    }
  }, updateMeter);
  
  // Delete a meter
  fastify.delete('/admin/meters/:id', {
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
  }, deleteMeter);
};

export default metersRoutes;