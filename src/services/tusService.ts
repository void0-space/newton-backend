import { Server as TusServer, EVENTS } from '@tus/server';
import { S3Store } from '@tus/s3-store';
import { FileStore } from '@tus/file-store';
import { FastifyInstance } from 'fastify';
import { StorageService } from './storageService';
import { db } from '../db/drizzle';
import { media } from '../db/schema';
import { createId } from '@paralleldrive/cuid2';
import path from 'path';
import mime from 'mime-types';

export class TusService {
  private server: TusServer;
  private storageService: StorageService;
  private fastify: FastifyInstance;

  constructor(fastify: FastifyInstance, storageService: StorageService) {
    this.fastify = fastify;
    this.storageService = storageService;
    
    // Configure storage backend
    const store = this.createStore();
    
    this.server = new TusServer({
      path: '/api/v1/media/upload',
      datastore: store,
      respectForwardedHeaders: true,
      allowedHeaders: ['authorization', 'x-organization-id', 'x-api-key'],
      maxSize: 100 * 1024 * 1024, // 100MB max file size
      
      // Enable all tus extensions
      extensions: ['creation', 'creation-with-upload', 'termination', 'checksum'],
      
      // Metadata handling
      onUploadCreate: async (req, res, upload) => {
        const organizationId = req.headers['x-organization-id'] as string;
        const apiKey = req.headers['x-api-key'] as string;
        
        if (!organizationId || !apiKey) {
          throw new Error('Organization ID and API key are required');
        }

        // Validate metadata
        const metadata = upload.metadata || {};
        const filename = metadata.filename || 'unknown';
        const filetype = metadata.filetype || 'application/octet-stream';
        
        // Validate file type
        const mediaType = this.storageService.getMediaType(filetype);
        if (mediaType === 'unknown') {
          throw new Error('Unsupported file type');
        }

        // Validate file size
        if (!this.storageService.validateFileSize(upload.size || 0, mediaType)) {
          throw new Error(`File size too large for ${mediaType} type`);
        }

        // Add organization metadata for processing
        upload.metadata = {
          ...metadata,
          organizationId,
          mediaType,
          mediaId: createId(),
        };

        this.fastify.log.info(`Upload created: ${upload.id}`, {
          organizationId,
          filename,
          filetype,
          size: upload.size,
        });

        return upload;
      },

      onUploadFinish: async (req, res, upload) => {
        this.fastify.log.info(`Upload finished: ${upload.id}`);
        
        try {
          await this.processCompletedUpload(upload);
        } catch (error) {
          this.fastify.log.error(`Error processing completed upload: ${upload.id}`, error);
          throw error;
        }
      },

      onUploadProgress: (req, res, upload) => {
        const progress = ((upload.offset || 0) / (upload.size || 1)) * 100;
        this.fastify.log.debug(`Upload progress: ${upload.id} - ${progress.toFixed(1)}%`);
      },

      onResponseError: (req, res, err) => {
        this.fastify.log.error('Tus response error: ' + (err instanceof Error ? err.message : String(err)));
      },
    });

    this.setupEventListeners();
  }

  private createStore() {
    if (process.env.S3_ENDPOINT || process.env.S3_BUCKET) {
      // Use S3 store for production
      return new S3Store({
        bucket: process.env.S3_BUCKET || 'whatsapp-media-uploads',
        region: process.env.S3_REGION || 'us-east-1',
        credentials: {
          accessKeyId: process.env.S3_ACCESS_KEY || '',
          secretAccessKey: process.env.S3_SECRET_KEY || '',
        },
        ...(process.env.S3_ENDPOINT && {
          endpoint: process.env.S3_ENDPOINT,
          forcePathStyle: true,
        }),
      });
    } else {
      // Use file store for development
      return new FileStore({
        directory: './uploads',
      });
    }
  }

  private setupEventListeners() {
    this.server.on(EVENTS.POST_CREATE, (req, res, upload, url) => {
      this.fastify.log.info(`Upload created: ${upload.id} at ${url}`);
    });

    this.server.on(EVENTS.POST_FINISH, (req, res, upload) => {
      this.fastify.log.info(`Upload completed: ${upload.id}`);
    });

    this.server.on(EVENTS.POST_TERMINATE, (req, res, id) => {
      this.fastify.log.info(`Upload terminated: ${id}`);
    });

    this.server.on(EVENTS.POST_RECEIVE, (req, res, upload) => {
      this.fastify.log.debug(`Upload chunk received: ${upload.id}, offset: ${upload.offset}`);
    });
  }

  private async processCompletedUpload(upload: any) {
    const metadata = upload.metadata || {};
    const organizationId = metadata.organizationId;
    const mediaId = metadata.mediaId;
    const filename = metadata.filename || 'unknown';
    const filetype = metadata.filetype || 'application/octet-stream';
    const mediaType = metadata.mediaType;

    try {
      // For S3 store, the file is already uploaded to S3
      // For file store, we need to move it to S3
      let fileKey: string;
      let fileUrl: string;
      let thumbnailUrl: string | undefined;

      if (this.server.datastore instanceof S3Store) {
        // File is already in S3, just get the key and URL
        fileKey = `uploads/${upload.id}`;
        fileUrl = this.storageService.getPublicUrl(fileKey);
      } else {
        // Read from local file store and upload to S3
        const localPath = path.join('./uploads', upload.id);
        const fs = await import('fs/promises');
        const buffer = await fs.readFile(localPath);
        
        const extension = path.extname(filename) || mime.extension(filetype) || '';
        const result = await this.storageService.uploadBuffer(buffer, {
          organizationId,
          filename,
          contentType: filetype,
          size: upload.size || 0,
        });
        
        fileKey = result.key;
        fileUrl = result.url;
        
        // Clean up local file
        await fs.unlink(localPath).catch(() => {});
      }

      // Generate thumbnail for images
      if (mediaType === 'image') {
        try {
          // Get the image buffer for thumbnail generation
          let imageBuffer: Buffer;
          
          if (this.server.datastore instanceof S3Store) {
            const { stream } = await this.storageService.getObject(fileKey);
            const chunks: Buffer[] = [];
            
            for await (const chunk of stream) {
              chunks.push(chunk);
            }
            imageBuffer = Buffer.concat(chunks);
          } else {
            const fs = await import('fs/promises');
            const localPath = path.join('./uploads', upload.id);
            imageBuffer = await fs.readFile(localPath);
          }

          // Generate thumbnail
          const thumbnailBuffer = await this.storageService.generateThumbnail(imageBuffer);
          const thumbnailExtension = '.jpg';
          const thumbnailKey = fileKey.replace(path.extname(fileKey), `_thumb${thumbnailExtension}`);
          
          const thumbnailResult = await this.storageService.uploadBuffer(thumbnailBuffer, {
            organizationId,
            filename: `thumb_${filename}`,
            contentType: 'image/jpeg',
            size: thumbnailBuffer.length,
            key: thumbnailKey,
          });
          
          thumbnailUrl = thumbnailResult.url;
        } catch (error) {
          this.fastify.log.warn(`Failed to generate thumbnail for ${upload.id}:`, error);
        }
      }

      // Save media metadata to database
      await db.insert(media).values({
        id: mediaId,
        organizationId,
        filename: path.basename(fileKey),
        originalName: filename,
        mimeType: filetype,
        size: upload.size || 0,
        url: fileUrl,
        thumbnailUrl,
        createdAt: new Date(),
      });

      this.fastify.log.info(`Media processed successfully: ${mediaId}`, {
        fileKey,
        mediaType,
        size: upload.size,
        hasThumbnail: !!thumbnailUrl,
      });

    } catch (error) {
      this.fastify.log.error(`Failed to process upload ${upload.id}:`, error);
      throw error;
    }
  }

  getServer(): TusServer {
    return this.server;
  }

  async getUploadInfo(uploadId: string) {
    try {
      return await this.server.datastore.getUpload(uploadId);
    } catch (error) {
      return null;
    }
  }

  async deleteUpload(uploadId: string) {
    try {
      await this.server.datastore.deleteUpload(uploadId);
      this.fastify.log.info(`Upload deleted: ${uploadId}`);
    } catch (error) {
      this.fastify.log.error(`Failed to delete upload ${uploadId}:`, error);
      throw error;
    }
  }
}