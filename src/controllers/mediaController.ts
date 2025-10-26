import { FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../db/drizzle';
import { media } from '../db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { z } from 'zod';
import { convertHeaders } from '../utils/header';
import { auth } from '../lib/auth';

// Get media list for organization
export async function getMediaList(request: FastifyRequest, reply: FastifyReply) {
  try {
    const headers = convertHeaders(request);
    const authSession = await auth.api.getSession({ headers });
    const organizationId = authSession?.session.activeOrganizationId;

    if (!organizationId) {
      return reply.status(400).send({
        error: 'Organization context required',
        code: 'ORGANIZATION_REQUIRED',
      });
    }

    const queryParams = request.query as {
      limit?: string;
      offset?: string;
      type?: string;
    };

    const limit = parseInt(queryParams.limit || '50');
    const offset = parseInt(queryParams.offset || '0');
    const type = queryParams.type;

    let query = db
      .select()
      .from(media)
      .where(
        and(
          eq(media.organizationId, organizationId),
          eq(media.uploadCompleted, true)
        )
      )
      .orderBy(desc(media.createdAt))
      .limit(limit)
      .offset(offset);

    // Filter by media type if specified
    if (type) {
      const typeFilter = type === 'image'
        ? 'image/%'
        : type === 'video'
        ? 'video/%'
        : type === 'audio'
        ? 'audio/%'
        : type === 'document'
        ? 'application/%'
        : null;

      if (typeFilter) {
        // Note: This would need a proper LIKE operator implementation
        // For now, we'll filter client-side or use string contains
        query = query.where(
          and(
            eq(media.organizationId, organizationId),
            eq(media.uploadCompleted, true)
          )
        );
      }
    }

    const mediaList = await query;

    // Filter by type on the result if needed (temporary solution)
    let filteredMedia = mediaList;
    if (type) {
      filteredMedia = mediaList.filter(item => {
        switch (type) {
          case 'image':
            return item.mimeType.startsWith('image/');
          case 'video':
            return item.mimeType.startsWith('video/');
          case 'audio':
            return item.mimeType.startsWith('audio/');
          case 'document':
            return item.mimeType.startsWith('application/') ||
                   item.mimeType.startsWith('text/');
          default:
            return true;
        }
      });
    }

    // Generate fresh signed URLs for all media items
    const { StorageService } = await import('../services/storageService');
    const storageService = new StorageService(request.server);

    const mediaWithFreshUrls = await Promise.all(
      filteredMedia.map(async (item) => {
        const uploadKey = `uploads/${item.tusId}`;
        const freshUrl = await storageService.generateDownloadUrl(uploadKey, 86400 * 7); // 7 days

        let freshThumbnailUrl = item.thumbnailUrl;
        if (item.thumbnailUrl && (item.mimeType.startsWith('image/') || item.mimeType.startsWith('video/'))) {
          const thumbnailKey = `thumbnails/${item.tusId}.jpg`;
          freshThumbnailUrl = await storageService.generateDownloadUrl(thumbnailKey, 86400 * 7);
        }

        return {
          ...item,
          url: freshUrl,
          thumbnailUrl: freshThumbnailUrl,
        };
      })
    );

    return reply.send({
      success: true,
      data: mediaWithFreshUrls,
      pagination: {
        limit,
        offset,
        total: filteredMedia.length, // This should ideally be a separate count query
      },
    });
  } catch (error) {
    request.log.error('Error fetching media list:', error);
    return reply.status(500).send({
      error: 'Failed to fetch media list',
      code: 'MEDIA_LIST_ERROR',
    });
  }
}

// Get single media item
export async function getMediaItem(request: FastifyRequest, reply: FastifyReply) {
  try {
    const { id } = request.params as { id: string };
    const headers = convertHeaders(request);
    const authSession = await auth.api.getSession({ headers });
    const organizationId = authSession?.session.activeOrganizationId;

    if (!organizationId) {
      return reply.status(400).send({
        error: 'Organization context required',
        code: 'ORGANIZATION_REQUIRED',
      });
    }

    const [mediaItem] = await db
      .select()
      .from(media)
      .where(
        and(
          eq(media.id, id),
          eq(media.organizationId, organizationId)
        )
      );

    if (!mediaItem) {
      return reply.status(404).send({
        error: 'Media not found',
        code: 'MEDIA_NOT_FOUND',
      });
    }

    // Generate fresh signed URLs
    const { StorageService } = await import('../services/storageService');
    const storageService = new StorageService(request.server);

    const uploadKey = `uploads/${mediaItem.tusId}`;
    const freshUrl = await storageService.generateDownloadUrl(uploadKey, 86400 * 7); // 7 days

    let freshThumbnailUrl = mediaItem.thumbnailUrl;
    if (mediaItem.thumbnailUrl && (mediaItem.mimeType.startsWith('image/') || mediaItem.mimeType.startsWith('video/'))) {
      const thumbnailKey = `thumbnails/${mediaItem.tusId}.jpg`;
      freshThumbnailUrl = await storageService.generateDownloadUrl(thumbnailKey, 86400 * 7);
    }

    return reply.send({
      success: true,
      data: {
        ...mediaItem,
        url: freshUrl,
        thumbnailUrl: freshThumbnailUrl,
      },
    });
  } catch (error) {
    request.log.error('Error fetching media item:', error);
    return reply.status(500).send({
      error: 'Failed to fetch media item',
      code: 'MEDIA_FETCH_ERROR',
    });
  }
}

// Delete media item
export async function deleteMediaItem(request: FastifyRequest, reply: FastifyReply) {
  try {
    const { id } = request.params as { id: string };
    const headers = convertHeaders(request);
    const authSession = await auth.api.getSession({ headers });
    const organizationId = authSession?.session.activeOrganizationId;

    if (!organizationId) {
      return reply.status(400).send({
        error: 'Organization context required',
        code: 'ORGANIZATION_REQUIRED',
      });
    }

    // First check if media exists and belongs to organization
    const [mediaItem] = await db
      .select()
      .from(media)
      .where(
        and(
          eq(media.id, id),
          eq(media.organizationId, organizationId)
        )
      );

    if (!mediaItem) {
      return reply.status(404).send({
        error: 'Media not found',
        code: 'MEDIA_NOT_FOUND',
      });
    }

    // TODO: Delete from R2 storage as well
    // This would require the S3 client to delete the actual files

    // Delete from database
    await db.delete(media).where(eq(media.id, id));

    return reply.send({
      success: true,
      message: 'Media deleted successfully',
    });
  } catch (error) {
    request.log.error('Error deleting media item:', error);
    return reply.status(500).send({
      error: 'Failed to delete media item',
      code: 'MEDIA_DELETE_ERROR',
    });
  }
}

// Update media metadata
export async function updateMediaMetadata(request: FastifyRequest, reply: FastifyReply) {
  try {
    const { id } = request.params as { id: string };
    const headers = convertHeaders(request);
    const authSession = await auth.api.getSession({ headers });
    const organizationId = authSession?.session.activeOrganizationId;

    if (!organizationId) {
      return reply.status(400).send({
        error: 'Organization context required',
        code: 'ORGANIZATION_REQUIRED',
      });
    }

    const updateSchema = z.object({
      originalName: z.string().optional(),
    });

    const body = updateSchema.parse(request.body);

    // First check if media exists and belongs to organization
    const [existingMedia] = await db
      .select()
      .from(media)
      .where(
        and(
          eq(media.id, id),
          eq(media.organizationId, organizationId)
        )
      );

    if (!existingMedia) {
      return reply.status(404).send({
        error: 'Media not found',
        code: 'MEDIA_NOT_FOUND',
      });
    }

    // Update media metadata
    const [updatedMedia] = await db
      .update(media)
      .set({
        ...body,
        updatedAt: new Date(),
      })
      .where(eq(media.id, id))
      .returning();

    return reply.send({
      success: true,
      data: updatedMedia,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return reply.status(400).send({
        error: 'Invalid request data',
        details: error.errors,
        code: 'VALIDATION_ERROR',
      });
    }

    request.log.error('Error updating media metadata:', error);
    return reply.status(500).send({
      error: 'Failed to update media metadata',
      code: 'MEDIA_UPDATE_ERROR',
    });
  }
}

// Get media stats for organization
export async function getMediaStats(request: FastifyRequest, reply: FastifyReply) {
  try {
    const headers = convertHeaders(request);
    const authSession = await auth.api.getSession({ headers });
    const organizationId = authSession?.session.activeOrganizationId;

    if (!organizationId) {
      return reply.status(400).send({
        error: 'Organization context required',
        code: 'ORGANIZATION_REQUIRED',
      });
    }

    // Get all media for organization
    const allMedia = await db
      .select()
      .from(media)
      .where(
        and(
          eq(media.organizationId, organizationId),
          eq(media.uploadCompleted, true)
        )
      );

    // Calculate stats
    const totalFiles = allMedia.length;
    const totalSize = allMedia.reduce((sum, item) => sum + item.size, 0);

    const typeStats = allMedia.reduce((stats, item) => {
      const type = item.mimeType.split('/')[0];
      stats[type] = (stats[type] || 0) + 1;
      return stats;
    }, {} as Record<string, number>);

    return reply.send({
      success: true,
      data: {
        totalFiles,
        totalSize,
        typeBreakdown: typeStats,
      },
    });
  } catch (error) {
    request.log.error('Error fetching media stats:', error);
    return reply.status(500).send({
      error: 'Failed to fetch media stats',
      code: 'MEDIA_STATS_ERROR',
    });
  }
}