import { FastifyRequest, FastifyReply } from 'fastify';
import { StorageService } from '../services/storageService';
import { db } from '../db/drizzle';
import { media } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import { createId } from '@paralleldrive/cuid2';

const uploadRequestSchema = z.object({
  filename: z.string().min(1, 'Filename is required'),
  contentType: z.string().min(1, 'Content type is required'),
  size: z.number().min(1, 'File size must be greater than 0'),
});

const directUploadSchema = z.object({
  filename: z.string().min(1, 'Filename is required'),
});

declare module 'fastify' {
  interface FastifyInstance {
    storage: StorageService;
  }
}

export async function requestUploadUrl(request: FastifyRequest, reply: FastifyReply) {
  try {
    const { filename, contentType, size } = uploadRequestSchema.parse(request.body);
    
    if (!request.organization) {
      return reply.status(400).send({
        error: 'Organization context required',
        code: 'ORGANIZATION_REQUIRED',
      });
    }

    // Validate content type
    const mediaType = request.server.storage.getMediaType(contentType);
    if (mediaType === 'unknown') {
      return reply.status(400).send({
        error: 'Unsupported file type',
        code: 'UNSUPPORTED_FILE_TYPE',
        supportedTypes: [
          'image/jpeg', 'image/png', 'image/gif', 'image/webp',
          'video/mp4', 'video/avi', 'video/mov', 'video/webm',
          'audio/mp3', 'audio/mpeg', 'audio/wav', 'audio/ogg',
          'application/pdf', 'text/plain'
        ],
      });
    }

    // Validate file size
    if (!request.server.storage.validateFileSize(size, mediaType)) {
      const limits = {
        image: '5MB',
        video: '50MB', 
        audio: '10MB',
        document: '20MB',
      };

      return reply.status(400).send({
        error: `File size exceeds limit for ${mediaType} files`,
        code: 'FILE_SIZE_EXCEEDED',
        limit: limits[mediaType],
      });
    }

    // Generate presigned upload URL
    const result = await request.server.storage.generateUploadUrl({
      organizationId: request.organization.id,
      filename,
      contentType,
      size,
    });

    return reply.send({
      success: true,
      data: {
        uploadUrl: result.uploadUrl,
        mediaId: result.mediaId,
        key: result.key,
        expiresIn: 3600, // 1 hour
        instructions: {
          method: 'PUT',
          headers: {
            'Content-Type': contentType,
          },
        },
      },
    });
  } catch (error) {
    request.log.error('Error generating upload URL: ' + (error instanceof Error ? error.message : String(error)));
    return reply.status(500).send({
      error: 'Failed to generate upload URL',
      code: 'UPLOAD_URL_FAILED',
    });
  }
}

export async function directUpload(request: FastifyRequest, reply: FastifyReply) {
  try {
    if (!request.organization) {
      return reply.status(400).send({
        error: 'Organization context required',
        code: 'ORGANIZATION_REQUIRED',
      });
    }

    // Handle multipart file upload
    const data = await request.file();
    if (!data) {
      return reply.status(400).send({
        error: 'No file provided',
        code: 'NO_FILE',
      });
    }

    const filename = data.filename;
    const contentType = data.mimetype;
    const buffer = await data.toBuffer();
    const size = buffer.length;

    // Validate content type
    const mediaType = request.server.storage.getMediaType(contentType);
    if (mediaType === 'unknown') {
      return reply.status(400).send({
        error: 'Unsupported file type',
        code: 'UNSUPPORTED_FILE_TYPE',
      });
    }

    // Validate file size
    if (!request.server.storage.validateFileSize(size, mediaType)) {
      return reply.status(400).send({
        error: `File size exceeds limit for ${mediaType} files`,
        code: 'FILE_SIZE_EXCEEDED',
      });
    }

    // Process image if needed
    let processedBuffer = buffer;
    let imageMetadata: { width?: number; height?: number } = {};

    if (mediaType === 'image') {
      const result = await request.server.storage.processImage(buffer);
      processedBuffer = result.processedBuffer;
      imageMetadata = {
        width: result.metadata.width,
        height: result.metadata.height,
      };
    }

    // Upload to storage
    const uploadResult = await request.server.storage.uploadBuffer(processedBuffer, {
      organizationId: request.organization.id,
      filename,
      contentType,
      size: processedBuffer.length,
    });

    // Generate thumbnail for images
    let thumbnailUrl: string | undefined;
    if (mediaType === 'image') {
      try {
        const thumbnailBuffer = await request.server.storage.generateThumbnail(processedBuffer);
        const thumbnailKey = uploadResult.key.replace(/(\.[^.]+)$/, '_thumb.jpg');
        
        const thumbnailResult = await request.server.storage.uploadBuffer(thumbnailBuffer, {
          organizationId: request.organization.id,
          filename: `thumb_${filename}`,
          contentType: 'image/jpeg',
          size: thumbnailBuffer.length,
          key: thumbnailKey,
        });
        
        thumbnailUrl = thumbnailResult.url;
      } catch (error) {
        request.log.warn('Failed to generate thumbnail: ' + (error instanceof Error ? error.message : String(error)));
      }
    }

    // Save media metadata
    const mediaId = createId();
    const [savedMedia] = await db.insert(media).values({
      id: mediaId,
      organizationId: request.organization.id,
      filename: uploadResult.key.split('/').pop() || filename,
      originalName: filename,
      mimeType: contentType,
      size: processedBuffer.length,
      url: uploadResult.url,
      thumbnailUrl,
      createdAt: new Date(),
    }).returning();

    // Track usage for media upload
    try {
      if (request.trackUsage) {
        const storageUsed = processedBuffer.length;
        await request.trackUsage('storage_used', storageUsed);
      }
    } catch (usageError) {
      request.log.warn('Failed to track usage for media upload: ' + (usageError instanceof Error ? usageError.message : String(usageError)));
    }

    return reply.send({
      success: true,
      data: {
        mediaId: savedMedia.id,
        filename: savedMedia.filename,
        originalName: savedMedia.originalName,
        contentType: savedMedia.mimeType,
        size: savedMedia.size,
        url: savedMedia.url,
        thumbnailUrl: savedMedia.thumbnailUrl,
        type: mediaType,
        ...imageMetadata,
        createdAt: savedMedia.createdAt,
      },
    });
  } catch (error) {
    request.log.error('Error in direct upload: ' + (error instanceof Error ? error.message : String(error)));
    return reply.status(500).send({
      error: 'Upload failed',
      code: 'UPLOAD_FAILED',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

export async function getMedia(request: FastifyRequest, reply: FastifyReply) {
  try {
    const { id } = request.params as { id: string };
    
    if (!request.organization) {
      return reply.status(400).send({
        error: 'Organization context required',
        code: 'ORGANIZATION_REQUIRED',
      });
    }

    const [mediaRecord] = await db
      .select()
      .from(media)
      .where(and(
        eq(media.id, id),
        eq(media.organizationId, request.organization.id)
      ))
      .limit(1);

    if (!mediaRecord) {
      return reply.status(404).send({
        error: 'Media not found',
        code: 'MEDIA_NOT_FOUND',
      });
    }

    // Generate fresh download URL
    const downloadUrl = await request.server.storage.generateDownloadUrl(
      mediaRecord.filename,
      3600 // 1 hour
    );

    return reply.send({
      success: true,
      data: {
        mediaId: mediaRecord.id,
        filename: mediaRecord.filename,
        originalName: mediaRecord.originalName,
        contentType: mediaRecord.mimeType,
        size: mediaRecord.size,
        url: downloadUrl,
        thumbnailUrl: mediaRecord.thumbnailUrl,
        createdAt: mediaRecord.createdAt,
      },
    });
  } catch (error) {
    request.log.error('Error fetching media: ' + (error instanceof Error ? error.message : String(error)));
    return reply.status(500).send({
      error: 'Failed to fetch media',
      code: 'FETCH_MEDIA_FAILED',
    });
  }
}

export async function downloadMedia(request: FastifyRequest, reply: FastifyReply) {
  try {
    const { id } = request.params as { id: string };
    const { download } = request.query as { download?: string };
    
    if (!request.organization) {
      return reply.status(400).send({
        error: 'Organization context required',
        code: 'ORGANIZATION_REQUIRED',
      });
    }

    const [mediaRecord] = await db
      .select()
      .from(media)
      .where(and(
        eq(media.id, id),
        eq(media.organizationId, request.organization.id)
      ))
      .limit(1);

    if (!mediaRecord) {
      return reply.status(404).send({
        error: 'Media not found',
        code: 'MEDIA_NOT_FOUND',
      });
    }

    // Get object from storage
    const { stream, contentType, contentLength } = await request.server.storage.getObject(
      mediaRecord.filename
    );

    // Set headers for file download
    reply.header('Content-Type', contentType);
    reply.header('Content-Length', contentLength);
    
    if (download === 'true') {
      reply.header('Content-Disposition', `attachment; filename="${mediaRecord.originalName}"`);
    } else {
      reply.header('Content-Disposition', `inline; filename="${mediaRecord.originalName}"`);
    }

    return reply.send(stream);
  } catch (error) {
    request.log.error('Error downloading media: ' + (error instanceof Error ? error.message : String(error)));
    return reply.status(500).send({
      error: 'Download failed',
      code: 'DOWNLOAD_FAILED',
    });
  }
}

export async function deleteMedia(request: FastifyRequest, reply: FastifyReply) {
  try {
    const { id } = request.params as { id: string };
    
    if (!request.organization) {
      return reply.status(400).send({
        error: 'Organization context required',
        code: 'ORGANIZATION_REQUIRED',
      });
    }

    const [mediaRecord] = await db
      .select()
      .from(media)
      .where(and(
        eq(media.id, id),
        eq(media.organizationId, request.organization.id)
      ))
      .limit(1);

    if (!mediaRecord) {
      return reply.status(404).send({
        error: 'Media not found',
        code: 'MEDIA_NOT_FOUND',
      });
    }

    // Delete from storage
    await request.server.storage.deleteObject(mediaRecord.filename);
    
    // Delete thumbnail if exists
    if (mediaRecord.thumbnailUrl) {
      const thumbnailKey = mediaRecord.filename.replace(/(\.[^.]+)$/, '_thumb.jpg');
      try {
        await request.server.storage.deleteObject(thumbnailKey);
      } catch (error) {
        request.log.warn('Failed to delete thumbnail: ' + (error instanceof Error ? error.message : String(error)));
      }
    }

    // Track negative storage usage when deleting media
    try {
      if (request.trackUsage) {
        await request.trackUsage('storage_used', -mediaRecord.size);
      }
    } catch (usageError) {
      request.log.warn('Failed to track usage for media deletion: ' + (usageError instanceof Error ? usageError.message : String(usageError)));
    }

    // Delete from database
    await db
      .delete(media)
      .where(eq(media.id, id));

    return reply.send({
      success: true,
      message: 'Media deleted successfully',
    });
  } catch (error) {
    request.log.error('Error deleting media: ' + (error instanceof Error ? error.message : String(error)));
    return reply.status(500).send({
      error: 'Delete failed',
      code: 'DELETE_FAILED',
    });
  }
}

export async function listMedia(request: FastifyRequest, reply: FastifyReply) {
  try {
    const { limit = 20, offset = 0, type } = request.query as {
      limit?: number;
      offset?: number;
      type?: string;
    };
    
    if (!request.organization) {
      return reply.status(400).send({
        error: 'Organization context required',
        code: 'ORGANIZATION_REQUIRED',
      });
    }

    let whereClause = eq(media.organizationId, request.organization.id);
    
    if (type) {
      whereClause = and(whereClause, eq(media.mimeType, type));
    }

    const mediaList = await db
      .select({
        id: media.id,
        filename: media.filename,
        originalName: media.originalName,
        mimeType: media.mimeType,
        size: media.size,
        thumbnailUrl: media.thumbnailUrl,
        createdAt: media.createdAt,
      })
      .from(media)
      .where(whereClause)
      .limit(limit)
      .offset(offset)
      .orderBy(media.createdAt);

    // Generate fresh download URLs
    const mediaWithUrls = await Promise.all(
      mediaList.map(async (item) => ({
        ...item,
        url: await request.server.storage.generateDownloadUrl(item.filename, 3600),
      }))
    );

    return reply.send({
      success: true,
      data: {
        media: mediaWithUrls,
        pagination: {
          limit,
          offset,
          hasMore: mediaList.length === limit,
        },
      },
    });
  } catch (error) {
    request.log.error('Error listing media: ' + (error instanceof Error ? error.message : String(error)));
    return reply.status(500).send({
      error: 'Failed to list media',
      code: 'LIST_MEDIA_FAILED',
    });
  }
}