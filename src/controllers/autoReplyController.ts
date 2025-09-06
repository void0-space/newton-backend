import { FastifyRequest, FastifyReply } from 'fastify';
import { eq, and, desc, asc, sql, inArray } from 'drizzle-orm';
import { db } from '../db/drizzle';
import { autoReply, autoReplyUsage, autoReplyLog, whatsappSession } from '../db/schema';
import { z } from 'zod';
import { createId } from '@paralleldrive/cuid2';
import { auth } from '../lib/auth';
import { convertHeaders } from '../utils/header';

// Validation schemas
const createAutoReplySchema = z.object({
  whatsappAccountId: z.string().min(1),
  name: z.string().min(1).max(100),
  triggerType: z.enum(['keyword', 'contains', 'exact_match', 'regex', 'all_messages', 'business_hours', 'after_hours']),
  keywords: z.array(z.string()).optional(),
  pattern: z.string().optional(),
  caseSensitive: z.boolean().default(false),
  responseType: z.enum(['text', 'media', 'template', 'forward']),
  responseText: z.string().optional(),
  mediaUrl: z.string().optional(),
  mediaType: z.enum(['image', 'video', 'audio', 'document']).optional(),
  templateName: z.string().optional(),
  templateParams: z.record(z.string()).optional(),
  forwardToNumber: z.string().optional(),
  businessHoursStart: z.string().optional(),
  businessHoursEnd: z.string().optional(),
  businessDays: z.array(z.number().min(0).max(6)).optional(),
  timezone: z.string().default('UTC'),
  delaySeconds: z.number().min(0).default(0),
  maxRepliesPerContact: z.number().min(0).default(1),
  maxRepliesPerHour: z.number().min(0).optional(),
  resetInterval: z.number().min(1).default(24),
  priority: z.number().min(1).default(1),
  isEnabled: z.boolean().default(true),
});

const updateAutoReplySchema = createAutoReplySchema.partial();

export async function createAutoReply(request: FastifyRequest, reply: FastifyReply) {
  try {
    const headers = convertHeaders(request);
    const authSession = await auth.api.getSession({ headers });

    if (!authSession?.session) {
      return reply.status(401).send({ 
        error: 'Authentication required',
        code: 'AUTH_REQUIRED' 
      });
    }

    const body = createAutoReplySchema.parse(request.body);
    const activeOrganizationId = authSession?.session.activeOrganizationId;

    if (!activeOrganizationId) {
      return reply.status(400).send({ 
        error: 'Organization context required',
        code: 'ORGANIZATION_REQUIRED' 
      });
    }

    // Verify WhatsApp account belongs to organization
    const account = await db
      .select()
      .from(whatsappSession)
      .where(
        and(
          eq(whatsappSession.id, body.whatsappAccountId),
          eq(whatsappSession.organizationId, activeOrganizationId)
        )
      )
      .limit(1);

    if (account.length === 0) {
      return reply.status(404).send({ error: 'WhatsApp account not found' });
    }

    // Validate response configuration based on type
    if (body.responseType === 'text' && !body.responseText) {
      return reply.status(400).send({ error: 'Response text is required for text responses' });
    }

    if (body.responseType === 'media' && (!body.mediaUrl || !body.mediaType)) {
      return reply.status(400).send({ error: 'Media URL and type are required for media responses' });
    }

    if (body.responseType === 'template' && !body.templateName) {
      return reply.status(400).send({ error: 'Template name is required for template responses' });
    }

    if (body.responseType === 'forward' && !body.forwardToNumber) {
      return reply.status(400).send({ error: 'Forward number is required for forward responses' });
    }

    // Create auto reply rule
    const newAutoReply = await db
      .insert(autoReply)
      .values({
        ...body,
        organizationId: activeOrganizationId,
        createdBy: authSession.session.userId,
      })
      .returning();

    return reply.send({
      success: true,
      data: newAutoReply[0],
    });
  } catch (error) {
    request.log.error('Error creating auto reply:', error);
    
    if (error instanceof z.ZodError) {
      return reply.status(400).send({
        error: 'Validation error',
        details: error.errors,
      });
    }

    return reply.status(500).send({
      error: 'Failed to create auto reply rule',
    });
  }
}

export async function listAutoReplies(request: FastifyRequest, reply: FastifyReply) {
  try {
    const headers = convertHeaders(request);
    const authSession = await auth.api.getSession({ headers });

    if (!authSession?.session) {
      return reply.status(401).send({ 
        error: 'Authentication required',
        code: 'AUTH_REQUIRED' 
      });
    }

    const activeOrganizationId = authSession?.session.activeOrganizationId;
    if (!activeOrganizationId) {
      return reply.status(400).send({ 
        error: 'Organization context required',
        code: 'ORGANIZATION_REQUIRED' 
      });
    }

    const query = request.query as { whatsappAccountId?: string; enabled?: string };

    let whereCondition = eq(autoReply.organizationId, activeOrganizationId);

    if (query.whatsappAccountId) {
      whereCondition = and(
        whereCondition,
        eq(autoReply.whatsappAccountId, query.whatsappAccountId)
      );
    }

    if (query.enabled !== undefined) {
      whereCondition = and(
        whereCondition,
        eq(autoReply.isEnabled, query.enabled === 'true')
      );
    }

    const rules = await db
      .select({
        ...autoReply,
        accountName: whatsappSession.name,
        accountPhone: whatsappSession.phoneNumber,
      })
      .from(autoReply)
      .leftJoin(whatsappSession, eq(autoReply.whatsappAccountId, whatsappSession.id))
      .where(whereCondition)
      .orderBy(desc(autoReply.priority), desc(autoReply.createdAt));

    return reply.send({
      success: true,
      data: rules,
    });
  } catch (error) {
    request.log.error('Error listing auto replies:', error);
    return reply.status(500).send({
      error: 'Failed to list auto reply rules',
    });
  }
}

export async function getAutoReply(request: FastifyRequest, reply: FastifyReply) {
  try {
    const headers = convertHeaders(request);
    const authSession = await auth.api.getSession({ headers });

    if (!authSession?.session) {
      return reply.status(401).send({ 
        error: 'Authentication required',
        code: 'AUTH_REQUIRED' 
      });
    }

    const { id } = request.params as { id: string };
    const activeOrganizationId = authSession?.session.activeOrganizationId;

    if (!activeOrganizationId) {
      return reply.status(400).send({ 
        error: 'Organization context required',
        code: 'ORGANIZATION_REQUIRED' 
      });
    }

    const rule = await db
      .select({
        ...autoReply,
        accountName: whatsappSession.name,
        accountPhone: whatsappSession.phoneNumber,
      })
      .from(autoReply)
      .leftJoin(whatsappSession, eq(autoReply.whatsappAccountId, whatsappSession.id))
      .where(
        and(
          eq(autoReply.id, id),
          eq(autoReply.organizationId, activeOrganizationId)
        )
      )
      .limit(1);

    if (rule.length === 0) {
      return reply.status(404).send({ error: 'Auto reply rule not found' });
    }

    return reply.send({
      success: true,
      data: rule[0],
    });
  } catch (error) {
    request.log.error('Error getting auto reply:', error);
    return reply.status(500).send({
      error: 'Failed to get auto reply rule',
    });
  }
}

export async function updateAutoReply(request: FastifyRequest, reply: FastifyReply) {
  try {
    const headers = convertHeaders(request);
    const authSession = await auth.api.getSession({ headers });

    if (!authSession?.session) {
      return reply.status(401).send({ 
        error: 'Authentication required',
        code: 'AUTH_REQUIRED' 
      });
    }

    const { id } = request.params as { id: string };
    const body = updateAutoReplySchema.parse(request.body);
    const activeOrganizationId = authSession?.session.activeOrganizationId;

    if (!activeOrganizationId) {
      return reply.status(400).send({ 
        error: 'Organization context required',
        code: 'ORGANIZATION_REQUIRED' 
      });
    }

    // Verify rule exists and belongs to organization
    const existingRule = await db
      .select()
      .from(autoReply)
      .where(
        and(
          eq(autoReply.id, id),
          eq(autoReply.organizationId, activeOrganizationId)
        )
      )
      .limit(1);

    if (existingRule.length === 0) {
      return reply.status(404).send({ error: 'Auto reply rule not found' });
    }

    // If WhatsApp account is being changed, verify it belongs to organization
    if (body.whatsappAccountId) {
      const account = await db
        .select()
        .from(whatsappSession)
        .where(
          and(
            eq(whatsappSession.id, body.whatsappAccountId),
            eq(whatsappSession.organizationId, activeOrganizationId)
          )
        )
        .limit(1);

      if (account.length === 0) {
        return reply.status(404).send({ error: 'WhatsApp account not found' });
      }
    }

    // Update the rule
    const updated = await db
      .update(autoReply)
      .set({
        ...body,
        updatedAt: new Date(),
      })
      .where(eq(autoReply.id, id))
      .returning();

    return reply.send({
      success: true,
      data: updated[0],
    });
  } catch (error) {
    request.log.error('Error updating auto reply:', error);
    
    if (error instanceof z.ZodError) {
      return reply.status(400).send({
        error: 'Validation error',
        details: error.errors,
      });
    }

    return reply.status(500).send({
      error: 'Failed to update auto reply rule',
    });
  }
}

export async function deleteAutoReply(request: FastifyRequest, reply: FastifyReply) {
  try {
    const headers = convertHeaders(request);
    const authSession = await auth.api.getSession({ headers });

    if (!authSession?.session) {
      return reply.status(401).send({ 
        error: 'Authentication required',
        code: 'AUTH_REQUIRED' 
      });
    }

    const { id } = request.params as { id: string };
    const activeOrganizationId = authSession?.session.activeOrganizationId;

    if (!activeOrganizationId) {
      return reply.status(400).send({ 
        error: 'Organization context required',
        code: 'ORGANIZATION_REQUIRED' 
      });
    }

    // Verify rule exists and belongs to organization
    const existingRule = await db
      .select()
      .from(autoReply)
      .where(
        and(
          eq(autoReply.id, id),
          eq(autoReply.organizationId, activeOrganizationId)
        )
      )
      .limit(1);

    if (existingRule.length === 0) {
      return reply.status(404).send({ error: 'Auto reply rule not found' });
    }

    // Delete the rule (cascade will handle related records)
    await db.delete(autoReply).where(eq(autoReply.id, id));

    return reply.send({
      success: true,
      message: 'Auto reply rule deleted successfully',
    });
  } catch (error) {
    request.log.error('Error deleting auto reply:', error);
    return reply.status(500).send({
      error: 'Failed to delete auto reply rule',
    });
  }
}

export async function toggleAutoReply(request: FastifyRequest, reply: FastifyReply) {
  try {
    const headers = convertHeaders(request);
    const authSession = await auth.api.getSession({ headers });

    if (!authSession?.session) {
      return reply.status(401).send({ 
        error: 'Authentication required',
        code: 'AUTH_REQUIRED' 
      });
    }

    const { id } = request.params as { id: string };
    const { enabled } = request.body as { enabled: boolean };
    const activeOrganizationId = authSession?.session.activeOrganizationId;

    if (!activeOrganizationId) {
      return reply.status(400).send({ 
        error: 'Organization context required',
        code: 'ORGANIZATION_REQUIRED' 
      });
    }

    const updated = await db
      .update(autoReply)
      .set({
        isEnabled: enabled,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(autoReply.id, id),
          eq(autoReply.organizationId, activeOrganizationId)
        )
      )
      .returning();

    if (updated.length === 0) {
      return reply.status(404).send({ error: 'Auto reply rule not found' });
    }

    return reply.send({
      success: true,
      data: updated[0],
    });
  } catch (error) {
    request.log.error('Error toggling auto reply:', error);
    return reply.status(500).send({
      error: 'Failed to toggle auto reply rule',
    });
  }
}

export async function getAutoReplyStats(request: FastifyRequest, reply: FastifyReply) {
  try {
    const headers = convertHeaders(request);
    const authSession = await auth.api.getSession({ headers });

    if (!authSession?.session) {
      return reply.status(401).send({ 
        error: 'Authentication required',
        code: 'AUTH_REQUIRED' 
      });
    }

    const activeOrganizationId = authSession?.session.activeOrganizationId;
    if (!activeOrganizationId) {
      return reply.status(400).send({ 
        error: 'Organization context required',
        code: 'ORGANIZATION_REQUIRED' 
      });
    }

    const query = request.query as { whatsappAccountId?: string; days?: string };
    const days = parseInt(query.days || '7');

    let whereCondition = eq(autoReplyLog.organizationId, activeOrganizationId);

    if (query.whatsappAccountId) {
      whereCondition = and(
        whereCondition,
        eq(autoReplyLog.whatsappAccountId, query.whatsappAccountId)
      );
    }

    // Add date filter
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    whereCondition = and(
      whereCondition,
      sql`${autoReplyLog.processedAt} >= ${startDate}`
    );

    const stats = await db
      .select({
        totalTriggers: sql<number>`count(*)::int`,
        totalReplies: sql<number>`count(case when ${autoReplyLog.responseStatus} = 'sent' then 1 end)::int`,
        totalFailed: sql<number>`count(case when ${autoReplyLog.responseStatus} = 'failed' then 1 end)::int`,
        totalSkipped: sql<number>`count(case when ${autoReplyLog.responseStatus} = 'skipped' then 1 end)::int`,
        avgResponseTime: sql<number>`avg(${autoReplyLog.responseTime})::int`,
      })
      .from(autoReplyLog)
      .where(whereCondition);

    return reply.send({
      success: true,
      data: stats[0],
    });
  } catch (error) {
    request.log.error('Error getting auto reply stats:', error);
    return reply.status(500).send({
      error: 'Failed to get auto reply statistics',
    });
  }
}