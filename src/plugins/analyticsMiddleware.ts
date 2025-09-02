import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { createId } from '@paralleldrive/cuid2';
import { db } from '../db/drizzle';
import { apiUsage, apiUsageDailyStats } from '../db/schema';
import { eq, and } from 'drizzle-orm';

declare module 'fastify' {
  interface FastifyRequest {
    analyticsData?: {
      startTime: number;
      organizationId?: string;
      apiKeyId?: string;
      whatsappSessionId?: string;
    };
  }
}

const analyticsMiddleware: FastifyPluginAsync = async (fastify) => {
  // Log that the analytics middleware is being registered
  fastify.log.info('Analytics middleware: Registering hooks...');
  // Pre-handler to capture request start time
  fastify.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    fastify.log.info(`Analytics: preHandler hook called for ${request.method} ${request.url}`);
    
    // Only track API routes
    if (!request.url.startsWith('/api/')) {
      fastify.log.info(`Analytics: Skipping non-API route ${request.url}`);
      return;
    }

    // Skip health check and status endpoints
    if (request.url === '/health' || request.url === '/api/v1/status') {
      fastify.log.info(`Analytics: Skipping health/status endpoint ${request.url}`);
      return;
    }

    fastify.log.info(`Analytics: Setting up analytics tracking for ${request.method} ${request.url}`);
    request.analyticsData = {
      startTime: Date.now(),
    };
  });

  // Response hook to log the API usage
  fastify.addHook('onResponse', async (request: FastifyRequest, reply: FastifyReply) => {
    fastify.log.info(`Analytics: onResponse hook called for ${request.method} ${request.url}`);
    
    if (!request.analyticsData) {
      fastify.log.warn(`Analytics: No analyticsData found for ${request.method} ${request.url}`);
      return;
    }

    fastify.log.info(`Analytics: Processing request ${request.method} ${request.url}`);

    try {
      const responseTime = Date.now() - request.analyticsData.startTime;
      const success = reply.statusCode >= 200 && reply.statusCode < 400;

      // Extract organization context (this happens after auth middleware has run)
      let organizationId = null;
      let apiKeyId = null;
      let whatsappSessionId = null;

      if (request.apiKey) {
        organizationId = request.apiKey.organizationId;
        apiKeyId = request.apiKey.id;
        whatsappSessionId = request.apiKey.whatsappAccountId;
      } else if ((request as any).organization?.id) {
        organizationId = (request as any).organization.id;
      }

      fastify.log.info(`Analytics: Organization context - organizationId: ${organizationId}, apiKeyId: ${apiKeyId}`);

      // Extract request/response data
      let requestBody = null;
      let responseBody = null;
      let messageType = null;
      let messageId = null;
      let recipientNumber = null;
      let errorCode = null;
      let errorMessage = null;

      // Parse request body if available
      if (request.body && typeof request.body === 'object') {
        requestBody = request.body;
        
        // Extract message-specific data
        if ('type' in request.body) {
          messageType = request.body.type as string;
        }
        if ('to' in request.body) {
          recipientNumber = request.body.to as string;
        }
      }

      // Try to get response payload if it's JSON (be careful with large responses)
      if (reply.getHeader('content-type')?.toString().includes('application/json')) {
        try {
          const payload = reply.payload;
          if (payload && typeof payload === 'string' && payload.length < 10000) {
            const parsed = JSON.parse(payload);
            responseBody = parsed;
            
            // Extract message ID from response
            if (parsed.messageId) {
              messageId = parsed.messageId;
            }
            
            // Extract error information
            if (!success && parsed.error) {
              errorMessage = parsed.error;
              errorCode = parsed.code;
            }
          }
        } catch (e) {
          // Ignore parsing errors
        }
      }

      // Log API usage
      fastify.log.info(`Analytics: Attempting to save analytics data for ${request.method} ${request.url}`);
      fastify.log.info(`Analytics: Organization ID: ${organizationId}, Success: ${success}, Status: ${reply.statusCode}`);
      
      await db.insert(apiUsage).values({
        id: createId(),
        organizationId,
        apiKeyId,
        whatsappSessionId,
        endpoint: request.url,
        method: request.method,
        statusCode: reply.statusCode,
        responseTime,
        requestBody,
        responseBody,
        userAgent: request.headers['user-agent'] || null,
        ipAddress: request.ip,
        messageType,
        messageId,
        recipientNumber,
        errorCode,
        errorMessage,
        success,
      });
      
      fastify.log.info(`Analytics: Successfully saved analytics data for ${request.method} ${request.url}`);

      // Update daily stats if organization is available
      if (organizationId) {
        await updateDailyStats(
          organizationId,
          apiKeyId,
          reply.statusCode,
          responseTime,
          messageType,
          success
        );
      }
    } catch (error) {
      fastify.log.error(`Analytics: Failed to log API usage for ${request.method} ${request.url}:`, error);
      // Don't fail the request if analytics logging fails
      
      // Log more details about the error
      if (error instanceof Error) {
        fastify.log.error(`Analytics: Error details: ${error.message}`);
        fastify.log.error(`Analytics: Error stack: ${error.stack}`);
      }
    }
  });
};

async function updateDailyStats(
  organizationId: string,
  apiKeyId: string | undefined,
  statusCode: number,
  responseTime: number,
  messageType: string | null,
  success: boolean
) {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Start of day

    // Try to find existing daily stats record
    const existingStats = await db
      .select()
      .from(apiUsageDailyStats)
      .where(
        and(
          eq(apiUsageDailyStats.organizationId, organizationId),
          eq(apiUsageDailyStats.date, today),
          apiKeyId ? eq(apiUsageDailyStats.apiKeyId, apiKeyId) : eq(apiUsageDailyStats.apiKeyId, null)
        )
      )
      .limit(1);

    if (existingStats.length > 0) {
      // Update existing record
      const current = existingStats[0];
      const updates: any = {
        totalRequests: current.totalRequests + 1,
        updatedAt: new Date(),
      };

      if (success) {
        updates.successfulRequests = current.successfulRequests + 1;
      } else {
        updates.failedRequests = current.failedRequests + 1;
      }

      // Update response time metrics
      const newTotal = current.totalRequests + 1;
      const currentAvg = current.avgResponseTime || 0;
      updates.avgResponseTime = Math.round((currentAvg * current.totalRequests + responseTime) / newTotal);
      updates.maxResponseTime = Math.max(current.maxResponseTime || 0, responseTime);
      updates.minResponseTime = current.minResponseTime 
        ? Math.min(current.minResponseTime, responseTime) 
        : responseTime;

      // Update message type counters
      if (messageType) {
        switch (messageType) {
          case 'text':
            updates.textMessages = current.textMessages + 1;
            break;
          case 'image':
            updates.imageMessages = current.imageMessages + 1;
            break;
          case 'video':
            updates.videoMessages = current.videoMessages + 1;
            break;
          case 'audio':
            updates.audioMessages = current.audioMessages + 1;
            break;
          case 'document':
            updates.documentMessages = current.documentMessages + 1;
            break;
        }
      }

      // Update status code counters
      if (statusCode >= 200 && statusCode < 300) {
        updates.status2xx = current.status2xx + 1;
      } else if (statusCode >= 400 && statusCode < 500) {
        updates.status4xx = current.status4xx + 1;
      } else if (statusCode >= 500) {
        updates.status5xx = current.status5xx + 1;
      }

      await db
        .update(apiUsageDailyStats)
        .set(updates)
        .where(eq(apiUsageDailyStats.id, current.id));
    } else {
      // Create new record
      const newStats: any = {
        id: createId(),
        organizationId,
        apiKeyId: apiKeyId || null,
        date: today,
        totalRequests: 1,
        successfulRequests: success ? 1 : 0,
        failedRequests: success ? 0 : 1,
        avgResponseTime: responseTime,
        maxResponseTime: responseTime,
        minResponseTime: responseTime,
        textMessages: messageType === 'text' ? 1 : 0,
        imageMessages: messageType === 'image' ? 1 : 0,
        videoMessages: messageType === 'video' ? 1 : 0,
        audioMessages: messageType === 'audio' ? 1 : 0,
        documentMessages: messageType === 'document' ? 1 : 0,
        status2xx: (statusCode >= 200 && statusCode < 300) ? 1 : 0,
        status4xx: (statusCode >= 400 && statusCode < 500) ? 1 : 0,
        status5xx: (statusCode >= 500) ? 1 : 0,
      };

      await db.insert(apiUsageDailyStats).values(newStats);
    }
  } catch (error) {
    // Log error but don't throw to avoid affecting the main request
    console.error('Failed to update daily stats:', error);
  }
}

export default analyticsMiddleware;