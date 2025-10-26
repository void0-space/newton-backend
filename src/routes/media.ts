import { FastifyPluginAsync } from 'fastify';
import {
  getMediaList,
  getMediaItem,
  deleteMediaItem,
  updateMediaMetadata,
  getMediaStats,
} from '../controllers/mediaController';

const mediaRoutes: FastifyPluginAsync = async (fastify, options) => {
  // Get all media for organization
  fastify.get('/', {
    handler: getMediaList,
  });

  // Get media stats
  fastify.get('/stats', {
    handler: getMediaStats,
  });

  // Get specific media item
  fastify.get('/:id', {
    handler: getMediaItem,
  });

  // Update media metadata
  fastify.patch('/:id', {
    handler: updateMediaMetadata,
  });

  // Delete media item
  fastify.delete('/:id', {
    handler: deleteMediaItem,
  });
};

export default mediaRoutes;