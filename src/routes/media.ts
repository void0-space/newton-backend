import { FastifyPluginAsync } from 'fastify';
import {
  requestUploadUrl,
  directUpload,
  getMedia,
  downloadMedia,
  deleteMedia,
  listMedia,
} from '../controllers/mediaController';

const mediaRoutes: FastifyPluginAsync = async (fastify) => {
  // All routes require API key and organization
  fastify.addHook('preHandler', async (request, reply) => {
    if (!request.apiKey) {
      return reply.status(401).send({
        error: 'API key required',
        code: 'API_KEY_REQUIRED',
      });
    }

    if (!request.organization) {
      return reply.status(400).send({
        error: 'Organization context required',
        code: 'ORGANIZATION_REQUIRED',
      });
    }
  });

  // Upload endpoints
  fastify.post('/upload/request', requestUploadUrl);
  fastify.post('/upload/direct', {
    preHandler: fastify.multipart,
  }, directUpload);

  // Media management endpoints
  fastify.get('/', listMedia);
  fastify.get('/:id', getMedia);
  fastify.get('/:id/download', downloadMedia);
  fastify.delete('/:id', deleteMedia);
};

export default mediaRoutes;