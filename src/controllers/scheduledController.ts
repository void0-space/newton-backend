import { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { createId } from '@paralleldrive/cuid2';
import { convertHeaders } from '../utils/header';
import { auth } from '../lib/auth';
import { db } from '../db/drizzle';
import { scheduledMessage, scheduledMessageLog, whatsappSession } from '../db/schema';
import { eq, and, count, desc, gte, lte } from 'drizzle-orm';

const createScheduledMessageSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  sessionId: z.string().min(1, 'Session ID is required'),
  recipients: z.array(z.string().min(1, 'Recipient phone number is required')),
  messageType: z.enum(['text', 'image', 'video', 'audio', 'document']).default('text'),
  content: z.object({
    text: z.string().optional(),
    caption: z.string().optional(),
  }),
  mediaUrl: z.string().optional(),
  scheduledFor: z.string().datetime('Invalid scheduled time format'),
  isRecurring: z.boolean().default(false),
  recurringPattern: z.object({
    frequency: z.enum(['daily', 'weekly', 'monthly']).optional(),
    interval: z.number().min(1).optional(),
    daysOfWeek: z.array(z.number().min(0).max(6)).optional(),
    endDate: z.string().datetime().optional(),
  }).optional(),
});

const updateScheduledMessageSchema = createScheduledMessageSchema.partial().extend({
  id: z.string(),
});

export async function createScheduledMessage(request: FastifyRequest, reply: FastifyReply) {
  try {
    const body = createScheduledMessageSchema.parse(request.body);
    const headers = convertHeaders(request);

    const authSession = await auth.api.getSession({ headers });
    const organizationId = authSession?.session.activeOrganizationId;
    
    if (!organizationId) {
      return reply.status(400).send({
        error: 'Organization context required',
        code: 'ORGANIZATION_REQUIRED',
      });
    }

    // Verify session exists and belongs to organization
    const [session] = await db
      .select()
      .from(whatsappSession)
      .where(and(eq(whatsappSession.id, body.sessionId), eq(whatsappSession.organizationId, organizationId)))
      .limit(1);

    if (!session) {
      return reply.status(404).send({
        error: 'WhatsApp session not found',
        code: 'SESSION_NOT_FOUND',
      });
    }

    // Validate scheduled time is in the future
    const scheduledTime = new Date(body.scheduledFor);
    if (scheduledTime <= new Date()) {
      return reply.status(400).send({
        error: 'Scheduled time must be in the future',
        code: 'INVALID_SCHEDULED_TIME',
      });
    }

    const scheduledId = createId();
    const scheduledData = {
      id: scheduledId,
      organizationId,
      sessionId: body.sessionId,
      name: body.name,
      recipients: body.recipients,
      messageType: body.messageType,
      content: body.content,
      mediaUrl: body.mediaUrl || null,
      scheduledFor: scheduledTime,
      isRecurring: body.isRecurring,
      recurringPattern: body.recurringPattern || null,
    };

    const [createdScheduled] = await db.insert(scheduledMessage).values(scheduledData).returning();

    return reply.status(201).send({
      success: true,
      data: createdScheduled,
    });
  } catch (error) {
    request.log.error('Error creating scheduled message: ' + (error instanceof Error ? error.message : String(error)));
    
    if (error instanceof z.ZodError) {
      return reply.status(400).send({
        error: 'Validation error',
        code: 'VALIDATION_ERROR',
        details: error.errors,
      });
    }

    return reply.status(500).send({
      error: 'Failed to create scheduled message',
      code: 'CREATE_SCHEDULED_FAILED',
    });
  }
}

export async function getScheduledMessages(request: FastifyRequest, reply: FastifyReply) {
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

    const query = request.query as {
      page?: string;
      limit?: string;
      status?: string;
      sessionId?: string;
      dateFrom?: string;
      dateTo?: string;
    };

    const page = parseInt(query.page || '1', 10);
    const limit = parseInt(query.limit || '20', 10);
    const offset = (page - 1) * limit;

    let whereConditions = [eq(scheduledMessage.organizationId, organizationId)];

    if (query.status) {
      whereConditions.push(eq(scheduledMessage.status, query.status));
    }

    if (query.sessionId) {
      whereConditions.push(eq(scheduledMessage.sessionId, query.sessionId));
    }

    if (query.dateFrom) {
      whereConditions.push(gte(scheduledMessage.scheduledFor, new Date(query.dateFrom)));
    }

    if (query.dateTo) {
      whereConditions.push(lte(scheduledMessage.scheduledFor, new Date(query.dateTo)));
    }

    const scheduledMessages = await db
      .select({
        id: scheduledMessage.id,
        organizationId: scheduledMessage.organizationId,
        sessionId: scheduledMessage.sessionId,
        name: scheduledMessage.name,
        recipients: scheduledMessage.recipients,
        messageType: scheduledMessage.messageType,
        content: scheduledMessage.content,
        mediaUrl: scheduledMessage.mediaUrl,
        scheduledFor: scheduledMessage.scheduledFor,
        status: scheduledMessage.status,
        isRecurring: scheduledMessage.isRecurring,
        recurringPattern: scheduledMessage.recurringPattern,
        createdAt: scheduledMessage.createdAt,
        updatedAt: scheduledMessage.updatedAt,
        sentAt: scheduledMessage.sentAt,
        errorMessage: scheduledMessage.errorMessage,
      })
      .from(scheduledMessage)
      .where(and(...whereConditions))
      .orderBy(desc(scheduledMessage.scheduledFor))
      .limit(limit)
      .offset(offset);

    // Get total count for pagination
    const [{ total }] = await db
      .select({ total: count() })
      .from(scheduledMessage)
      .where(and(...whereConditions));

    // Get session information for each scheduled message
    const sessions = await db
      .select()
      .from(whatsappSession)
      .where(eq(whatsappSession.organizationId, organizationId));

    const sessionMap = new Map(sessions.map(s => [s.id, s]));

    // Format messages with session information
    const formattedMessages = scheduledMessages.map(msg => {
      const session = sessionMap.get(msg.sessionId);
      return {
        ...msg,
        accountName: session?.phoneNumber || session?.name || 'WhatsApp Account',
        accountPhone: session?.phoneNumber || 'Unknown',
      };
    });

    return reply.send({
      success: true,
      data: formattedMessages,
      pagination: {
        page,
        limit,
        total,
        hasMore: formattedMessages.length === limit,
      },
    });
  } catch (error) {
    request.log.error('Error fetching scheduled messages: ' + (error instanceof Error ? error.message : String(error)));
    return reply.status(500).send({
      error: 'Failed to fetch scheduled messages',
      code: 'FETCH_SCHEDULED_FAILED',
    });
  }
}

export async function getScheduledMessage(request: FastifyRequest, reply: FastifyReply) {
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

    const [scheduled] = await db
      .select()
      .from(scheduledMessage)
      .where(and(eq(scheduledMessage.id, id), eq(scheduledMessage.organizationId, organizationId)))
      .limit(1);

    if (!scheduled) {
      return reply.status(404).send({
        error: 'Scheduled message not found',
        code: 'SCHEDULED_NOT_FOUND',
      });
    }

    return reply.send({
      success: true,
      data: scheduled,
    });
  } catch (error) {
    request.log.error('Error fetching scheduled message: ' + (error instanceof Error ? error.message : String(error)));
    return reply.status(500).send({
      error: 'Failed to fetch scheduled message',
      code: 'FETCH_SCHEDULED_FAILED',
    });
  }
}

export async function updateScheduledMessage(request: FastifyRequest, reply: FastifyReply) {
  try {
    const { id } = request.params as { id: string };
    const body = updateScheduledMessageSchema.parse({ ...request.body, id });
    const headers = convertHeaders(request);

    const authSession = await auth.api.getSession({ headers });
    const organizationId = authSession?.session.activeOrganizationId;
    
    if (!organizationId) {
      return reply.status(400).send({
        error: 'Organization context required',
        code: 'ORGANIZATION_REQUIRED',
      });
    }

    // Check if scheduled message exists and is not already sent
    const [existing] = await db
      .select()
      .from(scheduledMessage)
      .where(and(eq(scheduledMessage.id, id), eq(scheduledMessage.organizationId, organizationId)))
      .limit(1);

    if (!existing) {
      return reply.status(404).send({
        error: 'Scheduled message not found',
        code: 'SCHEDULED_NOT_FOUND',
      });
    }

    if (existing.status === 'sent') {
      return reply.status(400).send({
        error: 'Cannot update already sent message',
        code: 'MESSAGE_ALREADY_SENT',
      });
    }

    // Validate scheduled time if provided
    if (body.scheduledFor) {
      const scheduledTime = new Date(body.scheduledFor);
      if (scheduledTime <= new Date()) {
        return reply.status(400).send({
          error: 'Scheduled time must be in the future',
          code: 'INVALID_SCHEDULED_TIME',
        });
      }
    }

    const updateData = {
      ...body,
      id: undefined, // Remove id from update data
      updatedAt: new Date(),
      scheduledFor: body.scheduledFor ? new Date(body.scheduledFor) : undefined,
    };

    const [updated] = await db
      .update(scheduledMessage)
      .set(updateData)
      .where(and(eq(scheduledMessage.id, id), eq(scheduledMessage.organizationId, organizationId)))
      .returning();

    return reply.send({
      success: true,
      data: updated,
    });
  } catch (error) {
    request.log.error('Error updating scheduled message: ' + (error instanceof Error ? error.message : String(error)));

    if (error instanceof z.ZodError) {
      return reply.status(400).send({
        error: 'Validation error',
        code: 'VALIDATION_ERROR',
        details: error.errors,
      });
    }

    return reply.status(500).send({
      error: 'Failed to update scheduled message',
      code: 'UPDATE_SCHEDULED_FAILED',
    });
  }
}

export async function deleteScheduledMessage(request: FastifyRequest, reply: FastifyReply) {
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

    // Check if scheduled message exists
    const [existing] = await db
      .select()
      .from(scheduledMessage)
      .where(and(eq(scheduledMessage.id, id), eq(scheduledMessage.organizationId, organizationId)))
      .limit(1);

    if (!existing) {
      return reply.status(404).send({
        error: 'Scheduled message not found',
        code: 'SCHEDULED_NOT_FOUND',
      });
    }

    // Update status to cancelled instead of deleting
    await db
      .update(scheduledMessage)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(and(eq(scheduledMessage.id, id), eq(scheduledMessage.organizationId, organizationId)));

    return reply.send({
      success: true,
      message: 'Scheduled message cancelled successfully',
    });
  } catch (error) {
    request.log.error('Error deleting scheduled message: ' + (error instanceof Error ? error.message : String(error)));
    return reply.status(500).send({
      error: 'Failed to cancel scheduled message',
      code: 'CANCEL_SCHEDULED_FAILED',
    });
  }
}