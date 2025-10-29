import { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { db } from '../db/drizzle';
import { apiUsage, apiUsageDailyStats } from '../db/schema';
import { eq, desc, and, gte, lte, like, sql, count, avg, max, min, sum } from 'drizzle-orm';
import { auth } from '../lib/auth';
import { convertHeaders } from '../utils/header';

const analyticsRoutes: FastifyPluginAsync = async fastify => {
  // Session-based authentication middleware
  const sessionAuthMiddleware = async (request: FastifyRequest, reply: any) => {
    try {
      // Convert Fastify headers to standard Headers object
      const headers = convertHeaders(request);

      request.log.info('Analytics: Session auth middleware - checking session');
      const session = await auth.api.getSession({ headers });

      request.log.info(
        `Analytics: Session dataaa: ${JSON.stringify({
          hasSession: !!session?.session,
          hasActiveOrg: !!session?.session?.activeOrganizationId,
          activeOrganizationId: session?.session?.activeOrganizationId,
        })}`
      );

      if (!session?.session) {
        request.log.warn('Analytics: No session found in auth middleware');
        return reply.status(401).send({
          error: 'Authentication required',
          code: 'AUTH_REQUIRED',
        });
      }

      if (!session?.session.activeOrganizationId) {
        request.log.warn('Analytics: No active organization found in session');
        return reply.status(400).send({
          error: 'User must be associated with an organization',
          code: 'NO_ORGANIZATION',
        });
      }

      // Set organization context for the request
      (request as any).organization = {
        id: session.session.activeOrganizationId,
        name: 'Unknown',
      };

      request.log.info(
        `Analytics: Session authenticated for organization: ${session.session.activeOrganizationId}`
      );
    } catch (error) {
      request.log.error(
        'Analytics: Error in session auth middleware: ' +
          (error instanceof Error ? error.message : String(error))
      );
      return reply.status(500).send({
        error: 'Authentication error',
        code: 'AUTH_ERROR',
      });
    }
  };

  // Schema for query parameters
  const analyticsQuerySchema = z.object({
    page: z.coerce.number().min(0).default(0),
    limit: z.coerce.number().min(1).max(100).default(20),
    endpoint: z.string().optional(),
    method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).optional(),
    status: z.enum(['success', 'error']).optional(),
    statusCode: z.coerce.number().optional(),
    messageType: z.string().optional(),
    apiKeyId: z.string().optional(),
    whatsappSessionId: z.string().optional(),
    dateFrom: z.string().optional(), // ISO date string
    dateTo: z.string().optional(), // ISO date string
    search: z.string().optional(), // General search term
  });

  const dailyStatsQuerySchema = z.object({
    dateFrom: z.string().optional(),
    dateTo: z.string().optional(),
    apiKeyId: z.string().optional(),
  });

  // Get API usage logs with infinite scroll support
  fastify.get('/usage', { preHandler: sessionAuthMiddleware }, async (request, reply) => {
    try {
      const organizationId = (request as any).organization.id;

      const query = analyticsQuerySchema.parse(request.query);

      // Build where conditions
      const conditions = [eq(apiUsage.organizationId, organizationId)];

      if (query.endpoint) {
        conditions.push(like(apiUsage.endpoint, `%${query.endpoint}%`));
      }

      if (query.method) {
        conditions.push(eq(apiUsage.method, query.method));
      }

      if (query.status === 'success') {
        conditions.push(eq(apiUsage.success, true));
      } else if (query.status === 'error') {
        conditions.push(eq(apiUsage.success, false));
      }

      if (query.statusCode) {
        conditions.push(eq(apiUsage.statusCode, query.statusCode));
      }

      if (query.messageType) {
        conditions.push(eq(apiUsage.messageType, query.messageType));
      }

      if (query.apiKeyId) {
        conditions.push(eq(apiUsage.apiKeyId, query.apiKeyId));
      }

      if (query.whatsappSessionId) {
        conditions.push(eq(apiUsage.whatsappSessionId, query.whatsappSessionId));
      }

      if (query.dateFrom) {
        conditions.push(gte(apiUsage.timestamp, new Date(query.dateFrom)));
      }

      if (query.dateTo) {
        conditions.push(lte(apiUsage.timestamp, new Date(query.dateTo)));
      }

      if (query.search) {
        // Search in endpoint, error message, or recipient number
        conditions.push(
          sql`(${apiUsage.endpoint} ILIKE ${`%${query.search}%`} OR 
               ${apiUsage.errorMessage} ILIKE ${`%${query.search}%`} OR 
               ${apiUsage.recipientNumber} ILIKE ${`%${query.search}%`})`
        );
      }

      // Get total count for pagination info
      const totalResult = await db
        .select({ count: count() })
        .from(apiUsage)
        .where(and(...conditions));

      const total = totalResult[0]?.count || 0;

      // Get paginated results
      const results = await db
        .select()
        .from(apiUsage)
        .where(and(...conditions))
        .orderBy(desc(apiUsage.timestamp))
        .limit(query.limit)
        .offset(query.page * query.limit);

      return reply.send({
        data: results,
        pagination: {
          page: query.page,
          limit: query.limit,
          total,
          hasMore: (query.page + 1) * query.limit < total,
        },
      });
    } catch (error) {
      fastify.log.error('Analytics usage error:', error);
      return reply.status(500).send({
        error: 'Failed to fetch usage analytics',
        code: 'ANALYTICS_FETCH_FAILED',
      });
    }
  });

  // Get daily aggregated stats
  fastify.get('/daily-stats', { preHandler: sessionAuthMiddleware }, async (request, reply) => {
    try {
      const organizationId = (request as any).organization.id;

      const query = dailyStatsQuerySchema.parse(request.query);

      const conditions = [eq(apiUsageDailyStats.organizationId, organizationId)];

      if (query.apiKeyId) {
        conditions.push(eq(apiUsageDailyStats.apiKeyId, query.apiKeyId));
      }

      if (query.dateFrom) {
        conditions.push(gte(apiUsageDailyStats.date, new Date(query.dateFrom)));
      }

      if (query.dateTo) {
        conditions.push(lte(apiUsageDailyStats.date, new Date(query.dateTo)));
      }

      const results = await db
        .select()
        .from(apiUsageDailyStats)
        .where(and(...conditions))
        .orderBy(desc(apiUsageDailyStats.date));

      return reply.send({
        data: results,
      });
    } catch (error) {
      fastify.log.error('Analytics daily stats error:', error);
      return reply.status(500).send({
        error: 'Failed to fetch daily stats',
        code: 'DAILY_STATS_FETCH_FAILED',
      });
    }
  });

  // Get overview statistics
  fastify.get('/overview', { preHandler: sessionAuthMiddleware }, async (request, reply) => {
    try {
      const organizationId = (request as any).organization.id;

      const query = z
        .object({
          dateFrom: z.string().optional(),
          dateTo: z.string().optional(),
        })
        .parse(request.query);

      const conditions = [eq(apiUsage.organizationId, organizationId)];

      if (query.dateFrom) {
        conditions.push(gte(apiUsage.timestamp, new Date(query.dateFrom)));
      }

      if (query.dateTo) {
        conditions.push(lte(apiUsage.timestamp, new Date(query.dateTo)));
      }

      // Get overall stats
      const overallStats = await db
        .select({
          totalRequests: count(),
          successfulRequests: count(sql`CASE WHEN ${apiUsage.success} = true THEN 1 END`),
          failedRequests: count(sql`CASE WHEN ${apiUsage.success} = false THEN 1 END`),
          avgResponseTime: sql<number>`CAST(AVG(${apiUsage.responseTime}) AS INTEGER)`,
          maxResponseTime: max(apiUsage.responseTime),
          minResponseTime: min(apiUsage.responseTime),
        })
        .from(apiUsage)
        .where(and(...conditions));

      // Get message type breakdown
      const messageTypeStats = await db
        .select({
          messageType: apiUsage.messageType,
          count: count(),
        })
        .from(apiUsage)
        .where(and(...conditions, sql`${apiUsage.messageType} IS NOT NULL`))
        .groupBy(apiUsage.messageType);

      // Get status code breakdown
      const statusCodeStats = await db
        .select({
          statusCode: apiUsage.statusCode,
          count: count(),
        })
        .from(apiUsage)
        .where(and(...conditions))
        .groupBy(apiUsage.statusCode)
        .orderBy(desc(count()));

      // Get endpoint breakdown (top 10)
      const endpointStats = await db
        .select({
          endpoint: apiUsage.endpoint,
          count: count(),
          avgResponseTime: sql<number>`CAST(AVG(${apiUsage.responseTime}) AS INTEGER)`,
        })
        .from(apiUsage)
        .where(and(...conditions))
        .groupBy(apiUsage.endpoint)
        .orderBy(desc(count()))
        .limit(10);

      // Get API key usage (top 10)
      const apiKeyStats = await db
        .select({
          apiKeyId: apiUsage.apiKeyId,
          count: count(),
        })
        .from(apiUsage)
        .where(and(...conditions, sql`${apiUsage.apiKeyId} IS NOT NULL`))
        .groupBy(apiUsage.apiKeyId)
        .orderBy(desc(count()))
        .limit(10);

      return reply.send({
        overall: overallStats[0] || {
          totalRequests: 0,
          successfulRequests: 0,
          failedRequests: 0,
          avgResponseTime: null,
          maxResponseTime: null,
          minResponseTime: null,
        },
        messageTypes: messageTypeStats,
        statusCodes: statusCodeStats,
        endpoints: endpointStats,
        apiKeys: apiKeyStats,
      });
    } catch (error) {
      fastify.log.error('Analytics overview error:', error);
      return reply.status(500).send({
        error: 'Failed to fetch analytics overview',
        code: 'ANALYTICS_OVERVIEW_FAILED',
      });
    }
  });

  // Get API keys for filtering
  fastify.get('/api-keys', { preHandler: sessionAuthMiddleware }, async (request, reply) => {
    try {
      const organizationId = (request as any).organization.id;

      // Get distinct API keys that have usage data
      const apiKeys = await db
        .selectDistinct({
          apiKeyId: apiUsage.apiKeyId,
        })
        .from(apiUsage)
        .where(
          and(eq(apiUsage.organizationId, organizationId), sql`${apiUsage.apiKeyId} IS NOT NULL`)
        );

      return reply.send({
        data: apiKeys.map(k => k.apiKeyId).filter(Boolean),
      });
    } catch (error) {
      fastify.log.error('Analytics API keys error:', error);
      return reply.status(500).send({
        error: 'Failed to fetch API keys',
        code: 'API_KEYS_FETCH_FAILED',
      });
    }
  });

  // Get WhatsApp sessions for filtering
  fastify.get('/sessions', { preHandler: sessionAuthMiddleware }, async (request, reply) => {
    try {
      const organizationId = (request as any).organization.id;

      // Get distinct WhatsApp sessions that have usage data
      const sessions = await db
        .selectDistinct({
          whatsappSessionId: apiUsage.whatsappSessionId,
        })
        .from(apiUsage)
        .where(
          and(
            eq(apiUsage.organizationId, organizationId),
            sql`${apiUsage.whatsappSessionId} IS NOT NULL`
          )
        );

      return reply.send({
        data: sessions.map(s => s.whatsappSessionId).filter(Boolean),
      });
    } catch (error) {
      fastify.log.error('Analytics sessions error:', error);
      return reply.status(500).send({
        error: 'Failed to fetch sessions',
        code: 'SESSIONS_FETCH_FAILED',
      });
    }
  });
};

export default analyticsRoutes;
