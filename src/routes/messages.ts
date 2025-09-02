import { FastifyPluginAsync } from 'fastify';
import {
  sendTextMessage,
  sendMediaMessage,
  sendMediaFromUrl,
  getMessageStatus,
  getMessages,
  getMessagesBySession,
} from '../controllers/messageController';

const messageRoutes: FastifyPluginAsync = async (fastify) => {
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

  // Message sending routes
  fastify.post('/send', sendTextMessage);
  fastify.post('/send/media', sendMediaMessage);
  fastify.post('/send/media/url', sendMediaFromUrl);

  // Message retrieval routes
  fastify.get('/', getMessages);
  fastify.get('/:id', getMessageStatus);
  fastify.get('/session/:sessionId', getMessagesBySession);
};

export default messageRoutes;