import { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import multipart from '@fastify/multipart';
import { StorageService } from '../services/storageService';
import { TusService } from '../services/tusService';

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

  // Initialize tus service for resumable uploads
  const tusService = new TusService(fastify, storageService);
  fastify.decorate('tus', tusService);

  // Register tus upload handler (includes OPTIONS handling)
  fastify.all('/api/v1/media/upload/*', async (request, reply) => {
    // Handle CORS preflight for OPTIONS requests
    if (request.method === 'OPTIONS') {
      reply
        .header('Access-Control-Allow-Origin', '*')
        .header('Access-Control-Allow-Methods', 'POST, GET, HEAD, PATCH, DELETE, OPTIONS')
        .header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Upload-Length, Upload-Offset, Tus-Resumable, Upload-Metadata, Authorization, X-Organization-Id, X-Api-Key')
        .header('Access-Control-Max-Age', '86400')
        .status(200)
        .send();
      return;
    }
    
    return tusService.getServer().handle(request.raw, reply.raw);
  });

  // Add tus headers to all upload responses
  fastify.addHook('onSend', async (request, reply, payload) => {
    if (request.url.startsWith('/api/v1/media/upload')) {
      reply
        .header('Access-Control-Allow-Origin', '*')
        .header('Access-Control-Expose-Headers', 'Upload-Offset, Location, Upload-Length, Tus-Version, Tus-Resumable, Tus-Max-Size, Tus-Extension, Upload-Metadata')
        .header('Tus-Resumable', '1.0.0')
        .header('Tus-Version', '1.0.0')
        .header('Tus-Extension', 'creation,creation-with-upload,termination,checksum')
        .header('Tus-Max-Size', '104857600'); // 100MB
    }
    return payload;
  });

  fastify.log.info('Storage plugin initialized with S3 and tus support');
};

declare module 'fastify' {
  interface FastifyInstance {
    storage: StorageService;
    tus: TusService;
    multipart: any;
  }
}

export default fp(storagePlugin, {
  name: 'storage-plugin',
});