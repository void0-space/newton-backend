import fp from 'fastify-plugin';
import { FastifyPluginAsync } from 'fastify';
import { Server } from '@tus/server';
import { S3Store } from '@tus/s3-store';
import { S3Client } from '@aws-sdk/client-s3';
import { db } from '../db/drizzle';
import { media } from '../db/schema';
import { createId } from '@paralleldrive/cuid2';
import { eq } from 'drizzle-orm';
import path from 'path';
import sharp from 'sharp';
import { auth } from '../lib/auth';

const tusPlugin: FastifyPluginAsync = async (fastify, options) => {
  // Add raw content type parser for TUS that doesn't consume the body
  fastify.addContentTypeParser('application/offset+octet-stream', (req, payload, done) => {
    // Don't parse body - pass raw request to TUS server
    done(null, payload);
  });

  // Create S3 client for thumbnail generation
  const s3Client = new S3Client({
    region: 'auto',
    endpoint: `https://${fastify.config.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: fastify.config.CLOUDFLARE_R2_ACCESS_KEY_ID,
      secretAccessKey: fastify.config.CLOUDFLARE_R2_SECRET_ACCESS_KEY,
    },
  });

  // Use FileStore instead of S3Store for better reliability
  const { FileStore } = await import('@tus/file-store');
  const path = await import('path');
  const uploadDir = path.join(process.cwd(), 'uploads');

  const tusStore = new FileStore({
    directory: uploadDir,
  });

  fastify.log.info(`Using FileStore for TUS uploads at ${uploadDir}`);

  // Create TUS server
  fastify.log.info('Creating TUS server with FileStore...');
  const tusServer = new Server({
    datastore: tusStore,
    path: '/api/v1/media/upload',
    namingFunction: req => {
      // Generate unique filename
      const uploadId = createId();
      return uploadId;
    },
    onUploadCreate: async (req, res, upload) => {
      fastify.log.info(`TUS onUploadCreate called for upload: ${upload.id}`);
      fastify.log.info(
        `TUS onUploadCreate: size=${upload.size}, metadata=${JSON.stringify(upload.metadata)}`
      );

      // Get organization context from session via auth
      try {
        const headers = new Headers();
        Object.entries(req.headers).forEach(([key, value]) => {
          if (value) headers.append(key, Array.isArray(value) ? value[0] : value);
        });

        const authSession = await auth.api.getSession({ headers });
        const organizationId = authSession?.session.activeOrganizationId;

        if (!organizationId) {
          throw new Error('Organization context required');
        }

        // Extract metadata from upload
        const metadata = upload.metadata || {};
        const filename = metadata.filename || 'unknown';
        const mimeType = metadata.filetype || 'application/octet-stream';
        const size = upload.size || 0;

        // Create media record in database
        await db.insert(media).values({
          id: createId(),
          organizationId,
          tusId: upload.id,
          filename: upload.id, // Use TUS ID as filename
          originalName: filename,
          mimeType,
          size: Number(size),
          url: '', // Will be set after upload completion
          uploadCompleted: false,
        });

        return res;
      } catch (error) {
        fastify.log.error(error, 'Error in onUploadCreate:');
        throw error;
      }
    },
    onUploadFinish: async (req, res, upload) => {
      fastify.log.info(`TUS onUploadFinish called for upload: ${upload.id}`);

      try {
        // Read the completed file from FileStore
        const fs = await import('fs');
        const path = await import('path');
        const filePath = path.join(process.cwd(), 'uploads', upload.id);

        fastify.log.info(`Reading completed file from: ${filePath}`);
        const fileBuffer = await fs.promises.readFile(filePath);

        // Upload to R2
        const { PutObjectCommand } = await import('@aws-sdk/client-s3');
        const uploadKey = `uploads/${upload.id}`;

        const putCommand = new PutObjectCommand({
          Bucket: fastify.config.CLOUDFLARE_R2_BUCKET,
          Key: uploadKey,
          Body: fileBuffer,
          ContentType: upload.metadata?.filetype || 'application/octet-stream',
        });

        await s3Client.send(putCommand);
        fastify.log.info(`File uploaded to R2: ${uploadKey}`);

        // Generate signed URL for the uploaded file
        const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
        const { GetObjectCommand } = await import('@aws-sdk/client-s3');

        const getObjectCommand = new GetObjectCommand({
          Bucket: fastify.config.CLOUDFLARE_R2_BUCKET,
          Key: uploadKey,
        });

        const signedUrl = await getSignedUrl(s3Client, getObjectCommand, {
          expiresIn: 86400 * 7, // 7 days
        });

        await db
          .update(media)
          .set({
            url: signedUrl,
            uploadCompleted: true,
            updatedAt: new Date(),
          })
          .where(eq(media.tusId, upload.id));

        // Generate thumbnail for images and videos
        const [mediaRecord] = await db.select().from(media).where(eq(media.tusId, upload.id));
        if (mediaRecord && (mediaRecord.mimeType.startsWith('image/') || mediaRecord.mimeType.startsWith('video/'))) {
          await generateThumbnail(fastify, s3Client, upload.id, mediaRecord);
        }

        // Clean up temporary file
        try {
          await fs.promises.unlink(filePath);
          fastify.log.info(`Cleaned up temp file: ${filePath}`);
        } catch (cleanupError) {
          fastify.log.warn(`Could not clean up temp file: ${cleanupError}`);
        }

        fastify.log.info(`Media record updated for upload: ${upload.id}`);
      } catch (error) {
        fastify.log.error(`Error in onUploadFinish: ${error}`);
      }

      return res;
    },
    onUploadCreated: (req, res, upload) => {
      fastify.log.info(`Upload created with ID: ${upload.id}`);
      return res;
    },
  });

  // Add dedicated CORS preflight handler with higher priority
  fastify.route({
    method: 'OPTIONS',
    url: '/api/v1/media/upload',
    config: {
      cors: false, // Disable global CORS for this route
    },
    handler: async (request, reply) => {
      fastify.log.info('TUS OPTIONS handler called for /api/v1/media/upload');

      const origin = request.headers.origin;
      const allowedOrigins = [
        'http://localhost:3000',
        'http://localhost:3001',
        'https://www.newton.ink',
        'https://newton.ink',
      ];

      if (origin && allowedOrigins.includes(origin)) {
        reply.header('Access-Control-Allow-Origin', origin);
        fastify.log.info(`TUS: Set Allow-Origin to ${origin}`);
      }

      reply.header('Access-Control-Allow-Credentials', 'true');
      reply.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, HEAD, OPTIONS');
      reply.header(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization, X-Requested-With, X-Organization-Id, tus-resumable, tus-version, tus-max-size, tus-extension, upload-length, upload-offset, upload-metadata, upload-defer-length, upload-concat, upload-checksum'
      );
      reply.header(
        'Access-Control-Expose-Headers',
        'tus-resumable, tus-version, tus-max-size, tus-extension, upload-length, upload-offset, upload-metadata, location'
      );

      fastify.log.info('TUS: Set Allow-Credentials to true');
      return reply.status(204).send();
    },
  });

  fastify.route({
    method: 'OPTIONS',
    url: '/api/v1/media/upload/*',
    config: {
      cors: false, // Disable global CORS for this route
    },
    handler: async (request, reply) => {
      fastify.log.info(`TUS OPTIONS handler called for ${request.url}`);

      const origin = request.headers.origin;
      const allowedOrigins = [
        'http://localhost:3000',
        'http://localhost:3001',
        'https://www.newton.ink',
        'https://newton.ink',
      ];

      if (origin && allowedOrigins.includes(origin)) {
        reply.header('Access-Control-Allow-Origin', origin);
        fastify.log.info(`TUS: Set Allow-Origin to ${origin}`);
      }

      reply.header('Access-Control-Allow-Credentials', 'true');
      reply.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, HEAD, OPTIONS');
      reply.header(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization, X-Requested-With, X-Organization-Id, tus-resumable, tus-version, tus-max-size, tus-extension, upload-length, upload-offset, upload-metadata, upload-defer-length, upload-concat, upload-checksum'
      );
      reply.header(
        'Access-Control-Expose-Headers',
        'tus-resumable, tus-version, tus-max-size, tus-extension, upload-length, upload-offset, upload-metadata, location'
      );

      fastify.log.info('TUS: Set Allow-Credentials to true');
      return reply.status(204).send();
    },
  });

  // Register TUS routes with raw handler and CORS support
  fastify.route({
    method: ['GET', 'POST', 'PATCH', 'DELETE', 'HEAD'],
    url: '/api/v1/media/upload',
    config: {
      // Skip content parsing and CORS for TUS routes
      bodyParser: false,
      cors: false,
    },
    preHandler: async (request, reply) => {
      // Handle CORS manually in preHandler
      fastify.log.info(`TUS preHandler: ${request.method} ${request.url}`);

      const origin = request.headers.origin;
      const allowedOrigins = [
        'http://localhost:3000',
        'http://localhost:3001',
        'https://www.newton.ink',
        'https://newton.ink',
      ];

      if (origin && allowedOrigins.includes(origin)) {
        reply.header('Access-Control-Allow-Origin', origin);
        fastify.log.info(`TUS preHandler: Set Allow-Origin to ${origin}`);
      }

      reply.header('Access-Control-Allow-Credentials', 'true');
      reply.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, HEAD, OPTIONS');
      reply.header(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization, X-Requested-With, X-Organization-Id, tus-resumable, tus-version, tus-max-size, tus-extension, upload-length, upload-offset, upload-metadata, upload-defer-length, upload-concat, upload-checksum'
      );
      reply.header(
        'Access-Control-Expose-Headers',
        'tus-resumable, tus-version, tus-max-size, tus-extension, upload-length, upload-offset, upload-metadata, location'
      );

      fastify.log.info(`TUS preHandler: Set Allow-Credentials to true for ${request.method}`);
    },
    handler: (request, reply) => {
      fastify.log.info(`TUS handler: Processing ${request.method} ${request.url}`);
      fastify.log.info(`TUS handler: tus-resumable: ${request.headers['tus-resumable']}`);
      fastify.log.info(`TUS handler: upload-offset: ${request.headers['upload-offset']}`);
      fastify.log.info(`TUS handler: upload-length: ${request.headers['upload-length']}`);
      fastify.log.info(`TUS handler: content-type: ${request.headers['content-type']}`);
      fastify.log.info(`TUS handler: content-length: ${request.headers['content-length']}`);

      reply.hijack();

      // Set CORS headers on raw response after hijacking
      const origin = request.headers.origin;
      if (origin === 'http://localhost:3000' || origin === 'http://localhost:3001') {
        reply.raw.setHeader('Access-Control-Allow-Origin', origin);
        reply.raw.setHeader('Access-Control-Allow-Credentials', 'true');
        reply.raw.setHeader(
          'Access-Control-Allow-Methods',
          'GET, POST, PATCH, DELETE, HEAD, OPTIONS'
        );
        reply.raw.setHeader(
          'Access-Control-Allow-Headers',
          'Content-Type, Authorization, X-Requested-With, X-Organization-Id, tus-resumable, tus-version, tus-max-size, tus-extension, upload-length, upload-offset, upload-metadata, upload-defer-length, upload-concat, upload-checksum'
        );
        reply.raw.setHeader(
          'Access-Control-Expose-Headers',
          'tus-resumable, tus-version, tus-max-size, tus-extension, upload-length, upload-offset, upload-metadata, location'
        );
      }

      fastify.log.info(`TUS handler: About to call tusServer.handle()`);
      tusServer.handle(request.raw, reply.raw);
      fastify.log.info(`TUS handler: tusServer.handle() completed`);
    },
  });

  fastify.route({
    method: ['GET', 'POST', 'PATCH', 'DELETE', 'HEAD'],
    url: '/api/v1/media/upload/*',
    config: {
      // Skip content parsing and CORS for TUS routes
      bodyParser: false,
      cors: false,
    },
    preHandler: async (request, reply) => {
      // Handle CORS manually in preHandler
      fastify.log.info(`TUS preHandler: ${request.method} ${request.url}`);

      const origin = request.headers.origin;
      const allowedOrigins = [
        'http://localhost:3000',
        'http://localhost:3001',
        'https://www.newton.ink',
        'https://newton.ink',
      ];

      if (origin && allowedOrigins.includes(origin)) {
        reply.header('Access-Control-Allow-Origin', origin);
        fastify.log.info(`TUS preHandler: Set Allow-Origin to ${origin}`);
      }

      reply.header('Access-Control-Allow-Credentials', 'true');
      reply.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, HEAD, OPTIONS');
      reply.header(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization, X-Requested-With, X-Organization-Id, tus-resumable, tus-version, tus-max-size, tus-extension, upload-length, upload-offset, upload-metadata, upload-defer-length, upload-concat, upload-checksum'
      );
      reply.header(
        'Access-Control-Expose-Headers',
        'tus-resumable, tus-version, tus-max-size, tus-extension, upload-length, upload-offset, upload-metadata, location'
      );

      fastify.log.info(`TUS preHandler: Set Allow-Credentials to true for ${request.method}`);
    },
    handler: (request, reply) => {
      fastify.log.info(`TUS handler: Processing ${request.method} ${request.url}`);
      fastify.log.info(`TUS handler: tus-resumable: ${request.headers['tus-resumable']}`);
      fastify.log.info(`TUS handler: upload-offset: ${request.headers['upload-offset']}`);
      fastify.log.info(`TUS handler: upload-length: ${request.headers['upload-length']}`);
      fastify.log.info(`TUS handler: content-type: ${request.headers['content-type']}`);
      fastify.log.info(`TUS handler: content-length: ${request.headers['content-length']}`);

      reply.hijack();

      // Set CORS headers on raw response after hijacking
      const origin = request.headers.origin;
      if (origin === 'http://localhost:3000' || origin === 'http://localhost:3001') {
        reply.raw.setHeader('Access-Control-Allow-Origin', origin);
        reply.raw.setHeader('Access-Control-Allow-Credentials', 'true');
        reply.raw.setHeader(
          'Access-Control-Allow-Methods',
          'GET, POST, PATCH, DELETE, HEAD, OPTIONS'
        );
        reply.raw.setHeader(
          'Access-Control-Allow-Headers',
          'Content-Type, Authorization, X-Requested-With, X-Organization-Id, tus-resumable, tus-version, tus-max-size, tus-extension, upload-length, upload-offset, upload-metadata, upload-defer-length, upload-concat, upload-checksum'
        );
        reply.raw.setHeader(
          'Access-Control-Expose-Headers',
          'tus-resumable, tus-version, tus-max-size, tus-extension, upload-length, upload-offset, upload-metadata, location'
        );
      }

      fastify.log.info(`TUS handler: About to call tusServer.handle()`);
      tusServer.handle(request.raw, reply.raw);
      fastify.log.info(`TUS handler: tusServer.handle() completed`);
    },
  });

  // Add route to get upload status
  fastify.get('/api/v1/media/:tusId/status', async (request, reply) => {
    const { tusId } = request.params as { tusId: string };

    const [mediaRecord] = await db.select().from(media).where(eq(media.tusId, tusId));

    if (!mediaRecord) {
      return reply.status(404).send({ error: 'Media not found' });
    }

    return reply.send({
      id: mediaRecord.id,
      tusId: mediaRecord.tusId,
      filename: mediaRecord.originalName,
      mimeType: mediaRecord.mimeType,
      size: mediaRecord.size,
      url: mediaRecord.url,
      thumbnailUrl: mediaRecord.thumbnailUrl,
      uploadCompleted: mediaRecord.uploadCompleted,
      createdAt: mediaRecord.createdAt,
    });
  });

  // Add a test CORS endpoint to debug
  fastify.route({
    method: 'OPTIONS',
    url: '/api/v1/media/test-cors',
    config: {
      cors: false,
    },
    handler: async (request, reply) => {
      fastify.log.info('TEST CORS handler called');

      const origin = request.headers.origin;
      if (origin === 'http://localhost:3000') {
        reply.header('Access-Control-Allow-Origin', 'http://localhost:3000');
      }

      reply.header('Access-Control-Allow-Credentials', 'true');
      reply.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, HEAD, OPTIONS');
      reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');

      fastify.log.info('TEST: Headers set, sending 204');
      return reply.status(204).send();
    },
  });

  fastify.log.info('TUS plugin initialized with FileStore + R2 backend');
};

// Thumbnail generation function
async function generateThumbnail(
  fastify: any,
  s3Client: S3Client,
  uploadId: string,
  mediaRecord: any
) {
  try {
    // Download the original file from R2
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const getObjectCommand = new GetObjectCommand({
      Bucket: fastify.config.CLOUDFLARE_R2_BUCKET,
      Key: `uploads/${uploadId}`,
    });

    const response = await s3Client.send(getObjectCommand);
    const fileBuffer = await streamToBuffer(response.Body);

    let thumbnailBuffer: Buffer;

    // Generate thumbnail based on file type
    if (mediaRecord.mimeType.startsWith('image/')) {
      // Generate image thumbnail using Sharp
      thumbnailBuffer = await sharp(fileBuffer)
        .resize(300, 300, {
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({ quality: 80 })
        .toBuffer();
    } else if (mediaRecord.mimeType.startsWith('video/')) {
      // Generate video thumbnail using the storage service
      const { StorageService } = await import('../services/storageService');
      const storageService = new StorageService(fastify);
      thumbnailBuffer = await storageService.generateVideoThumbnail(fileBuffer, {
        width: 300,
        height: 300,
        timeOffset: 1, // 1 second into the video
      });
    } else {
      throw new Error(`Unsupported media type for thumbnail generation: ${mediaRecord.mimeType}`);
    }

    // Upload thumbnail to R2
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    const thumbnailKey = `thumbnails/${uploadId}.jpg`;

    const putObjectCommand = new PutObjectCommand({
      Bucket: fastify.config.CLOUDFLARE_R2_BUCKET,
      Key: thumbnailKey,
      Body: thumbnailBuffer,
      ContentType: 'image/jpeg',
    });

    await s3Client.send(putObjectCommand);

    // Generate signed URL for the thumbnail
    const getThumbnailCommand = new GetObjectCommand({
      Bucket: fastify.config.CLOUDFLARE_R2_BUCKET,
      Key: thumbnailKey,
    });

    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
    const thumbnailUrl = await getSignedUrl(s3Client, getThumbnailCommand, {
      expiresIn: 86400 * 7, // 7 days
    });

    await db
      .update(media)
      .set({
        thumbnailUrl,
        updatedAt: new Date(),
      })
      .where(eq(media.id, mediaRecord.id));

    fastify.log.info(`Thumbnail generated for ${mediaRecord.mimeType} media: ${mediaRecord.id}`);
  } catch (error) {
    fastify.log.error(`Error generating thumbnail for ${mediaRecord.mimeType}: ${error}`);
  }
}

// Helper function to convert stream to buffer
async function streamToBuffer(stream: any): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export default fp(tusPlugin, {
  name: 'tus-plugin',
});
