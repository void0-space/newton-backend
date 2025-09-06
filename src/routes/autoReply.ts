import { FastifyPluginAsync } from 'fastify';
import { 
  createAutoReply, 
  listAutoReplies, 
  getAutoReply, 
  updateAutoReply, 
  deleteAutoReply,
  toggleAutoReply,
  getAutoReplyStats
} from '../controllers/autoReplyController';

const autoReplyRoutes: FastifyPluginAsync = async (fastify) => {
  // Auto reply CRUD routes - authentication handled in controllers
  fastify.post('/auto-replies', createAutoReply);
  fastify.get('/auto-replies', listAutoReplies);
  fastify.get('/auto-replies/stats', getAutoReplyStats);
  fastify.get('/auto-replies/:id', getAutoReply);
  fastify.put('/auto-replies/:id', updateAutoReply);
  fastify.delete('/auto-replies/:id', deleteAutoReply);
  fastify.patch('/auto-replies/:id/toggle', toggleAutoReply);
};

export default autoReplyRoutes;