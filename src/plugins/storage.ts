import { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import multipart from '@fastify/multipart';
import { StorageService } from '../services/storageService';

const storagePlugin: FastifyPluginAsync = async (fastify) => {
  // Register multipart support for file uploads
  await fastify.register(multipart, {
    limits: {
      fileSize: 100 * 1024 * 1024, // 100MB
      files: 1, // Single file per request
    },
    attachFieldsToBody: true,
  });

  // Initialize storage service
  const storageService = new StorageService(fastify);
  fastify.decorate('storage', storageService);

  fastify.log.info('Storage plugin initialized with S3 support (TUS removed)');
};

declare module 'fastify' {
  interface FastifyInstance {
    storage: StorageService;
    multipart: any;
  }
}

export default fp(storagePlugin, {
  name: 'storage-plugin',
});