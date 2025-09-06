import { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { createId } from '@paralleldrive/cuid2';
import { convertHeaders } from '../utils/header';
import { auth } from '../lib/auth';
import { db } from '../db/drizzle';
import { campaigns, campaignStats, campaignMessages, campaignTemplates, whatsappSession } from '../db/schema';
import { eq, and, count, desc, gte, lte, asc, or, ilike } from 'drizzle-orm';

// Validation schemas
const createCampaignSchema = z.object({
  name: z.string().min(1, 'Campaign name is required'),
  description: z.string().optional(),
  whatsappSessionId: z.string().min(1, 'WhatsApp session is required'),
  messageType: z.enum(['text', 'media', 'template']),
  content: z.object({
    text: z.string().optional(),
    caption: z.string().optional(),
    templateName: z.string().optional(),
    templateParams: z.record(z.string()).optional(),
  }),
  mediaUrl: z.string().url().optional(),
  mediaType: z.enum(['image', 'video', 'audio', 'document']).optional(),
  recipientType: z.enum(['all', 'groups', 'individual', 'csv_upload']),
  recipients: z.array(z.string()).default([]),
  groupIds: z.array(z.string()).optional(),
  csvData: z.object({
    fileName: z.string(),
    totalContacts: z.number(),
    uploadedAt: z.string(),
  }).optional(),
  priority: z.enum(['low', 'normal', 'high']).default('normal'),
  schedulingType: z.enum(['immediate', 'scheduled', 'recurring']).default('immediate'),
  scheduledFor: z.string().datetime().optional(),
  timezone: z.string().default('Asia/Kolkata'),
  recurringFrequency: z.enum(['daily', 'weekly', 'monthly']).optional(),
  recurringInterval: z.number().min(1).optional(),
  recurringDaysOfWeek: z.array(z.number().min(0).max(6)).optional(),
  recurringDayOfMonth: z.number().min(1).max(31).optional(),
  recurringEndDate: z.string().datetime().optional(),
  recurringMaxOccurrences: z.number().min(1).optional(),
  smartSchedulingEnabled: z.boolean().default(false),
  optimizeForTimezone: z.boolean().default(false),
  avoidWeekends: z.boolean().default(false),
  preferredTime: z.string().default('10:00'),
  batchSize: z.number().min(1).max(1000).default(100),
  delayBetweenMessages: z.number().min(1).max(300).default(5),
  respectBusinessHours: z.boolean().default(true),
  businessHoursStart: z.string().default('09:00'),
  businessHoursEnd: z.string().default('18:00'),
  templateId: z.string().optional(),
});

const updateCampaignSchema = createCampaignSchema.partial().extend({
  id: z.string(),
});

const campaignActionSchema = z.object({
  action: z.enum(['start', 'pause', 'resume', 'stop']),
});

const createTemplateSchema = z.object({
  name: z.string().min(1, 'Template name is required'),
  description: z.string().optional(),
  category: z.string().min(1, 'Category is required'),
  messageType: z.enum(['text', 'media', 'template']),
  content: z.object({
    text: z.string().optional(),
    caption: z.string().optional(),
    templateName: z.string().optional(),
    templateParams: z.record(z.string()).optional(),
  }),
  mediaUrl: z.string().url().optional(),
  mediaType: z.enum(['image', 'video', 'audio', 'document']).optional(),
  estimatedEngagement: z.number().min(0).max(100).default(75),
});

// Helper functions
async function validateWhatsAppSession(sessionId: string, organizationId: string) {
  const session = await db
    .select()
    .from(whatsappSession)
    .where(and(
      eq(whatsappSession.id, sessionId),
      eq(whatsappSession.organizationId, organizationId)
    ))
    .limit(1);

  if (!session.length) {
    throw new Error('WhatsApp session not found or not accessible');
  }

  return session[0];
}

async function createCampaignStats(campaignId: string) {
  const statsId = createId();
  await db.insert(campaignStats).values({
    id: statsId,
    campaignId,
    totalRecipients: 0,
    messagesSent: 0,
    messagesDelivered: 0,
    messagesFailed: 0,
    messagesRead: 0,
    messagesReplied: 0,
  });
  return statsId;
}

// Controller functions
export async function createCampaign(request: FastifyRequest, reply: FastifyReply) {
  try {
    const body = createCampaignSchema.parse(request.body);
    const headers = convertHeaders(request);

    const authSession = await auth.api.getSession({ headers });
    const organizationId = authSession?.session.activeOrganizationId;

    if (!organizationId) {
      return reply.status(400).send({
        error: 'Organization ID is required',
        code: 'MISSING_ORGANIZATION',
      });
    }

    // Validate WhatsApp session
    await validateWhatsAppSession(body.whatsappSessionId, organizationId);

    const campaignId = createId();
    
    // Determine campaign status based on scheduling
    let status: 'draft' | 'scheduled' | 'sending' = 'draft';
    if (body.schedulingType === 'immediate') {
      status = 'sending';
    } else if (body.schedulingType === 'scheduled' && body.scheduledFor) {
      status = 'scheduled';
    }

    // Create campaign
    const [campaign] = await db.insert(campaigns).values({
      id: campaignId,
      organizationId,
      whatsappSessionId: body.whatsappSessionId,
      name: body.name,
      description: body.description,
      status,
      priority: body.priority,
      messageType: body.messageType,
      content: body.content,
      mediaUrl: body.mediaUrl,
      mediaType: body.mediaType,
      recipientType: body.recipientType,
      recipients: body.recipients,
      groupIds: body.groupIds,
      csvData: body.csvData,
      schedulingType: body.schedulingType,
      scheduledFor: body.scheduledFor ? new Date(body.scheduledFor) : null,
      timezone: body.timezone,
      recurringFrequency: body.recurringFrequency,
      recurringInterval: body.recurringInterval,
      recurringDaysOfWeek: body.recurringDaysOfWeek,
      recurringDayOfMonth: body.recurringDayOfMonth,
      recurringEndDate: body.recurringEndDate ? new Date(body.recurringEndDate) : null,
      recurringMaxOccurrences: body.recurringMaxOccurrences,
      smartSchedulingEnabled: body.smartSchedulingEnabled,
      optimizeForTimezone: body.optimizeForTimezone,
      avoidWeekends: body.avoidWeekends,
      preferredTime: body.preferredTime,
      batchSize: body.batchSize,
      delayBetweenMessages: body.delayBetweenMessages,
      respectBusinessHours: body.respectBusinessHours,
      businessHoursStart: body.businessHoursStart,
      businessHoursEnd: body.businessHoursEnd,
      templateId: body.templateId,
      startedAt: status === 'sending' ? new Date() : null,
    }).returning();

    // Create campaign stats
    await createCampaignStats(campaignId);

    // If template was used, increment usage count
    if (body.templateId) {
      await db
        .update(campaignTemplates)
        .set({ usageCount: db.$count() })
        .where(eq(campaignTemplates.id, body.templateId));
    }

    return reply.status(201).send({
      success: true,
      data: campaign,
    });
  } catch (error) {
    request.log.error(`Error creating campaign: ${error}`);
    
    if (error instanceof z.ZodError) {
      return reply.status(400).send({
        error: 'Validation failed',
        details: error.errors,
        code: 'VALIDATION_ERROR',
      });
    }

    return reply.status(500).send({
      error: error instanceof Error ? error.message : 'Internal server error',
      code: 'CREATE_CAMPAIGN_ERROR',
    });
  }
}

export async function getCampaigns(request: FastifyRequest, reply: FastifyReply) {
  try {
    const headers = convertHeaders(request);
    const authSession = await auth.api.getSession({ headers });
    const organizationId = authSession?.session.activeOrganizationId;

    if (!organizationId) {
      return reply.status(400).send({
        error: 'Organization ID is required',
        code: 'MISSING_ORGANIZATION',
      });
    }

    const queryParams = request.query as {
      page?: string;
      limit?: string;
      status?: string;
      priority?: string;
      search?: string;
      sort?: string;
      order?: 'asc' | 'desc';
    };

    const page = parseInt(queryParams.page || '1');
    const limit = parseInt(queryParams.limit || '10');
    const offset = (page - 1) * limit;

    // Build where conditions
    const conditions = [eq(campaigns.organizationId, organizationId)];

    if (queryParams.status) {
      conditions.push(eq(campaigns.status, queryParams.status as any));
    }

    if (queryParams.priority) {
      conditions.push(eq(campaigns.priority, queryParams.priority as any));
    }

    if (queryParams.search) {
      conditions.push(
        or(
          ilike(campaigns.name, `%${queryParams.search}%`),
          ilike(campaigns.description, `%${queryParams.search}%`)
        )
      );
    }

    // Build order by
    const sortField = queryParams.sort || 'createdAt';
    const sortOrder = queryParams.order === 'asc' ? asc : desc;

    // Get campaigns with stats
    const campaignsData = await db
      .select({
        campaign: campaigns,
        stats: campaignStats,
        whatsappSession: {
          id: whatsappSession.id,
          name: whatsappSession.name,
          phoneNumber: whatsappSession.phoneNumber,
        },
      })
      .from(campaigns)
      .leftJoin(campaignStats, eq(campaigns.id, campaignStats.campaignId))
      .leftJoin(whatsappSession, eq(campaigns.whatsappSessionId, whatsappSession.id))
      .where(and(...conditions))
      .orderBy(sortOrder(campaigns[sortField as keyof typeof campaigns]))
      .limit(limit)
      .offset(offset);

    // Get total count
    const [totalResult] = await db
      .select({ count: count() })
      .from(campaigns)
      .where(and(...conditions));

    const total = totalResult.count;
    const totalPages = Math.ceil(total / limit);

    return reply.send({
      success: true,
      data: campaignsData,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    });
  } catch (error) {
    request.log.error(`Error getting campaigns: ${error}`);
    return reply.status(500).send({
      error: 'Internal server error',
      code: 'GET_CAMPAIGNS_ERROR',
    });
  }
}

export async function getCampaign(request: FastifyRequest, reply: FastifyReply) {
  try {
    const params = request.params as { id: string };
    const headers = convertHeaders(request);
    
    const authSession = await auth.api.getSession({ headers });
    const organizationId = authSession?.session.activeOrganizationId;

    if (!organizationId) {
      return reply.status(400).send({
        error: 'Organization ID is required',
        code: 'MISSING_ORGANIZATION',
      });
    }

    const [campaignData] = await db
      .select({
        campaign: campaigns,
        stats: campaignStats,
        whatsappSession: {
          id: whatsappSession.id,
          name: whatsappSession.name,
          phoneNumber: whatsappSession.phoneNumber,
        },
      })
      .from(campaigns)
      .leftJoin(campaignStats, eq(campaigns.id, campaignStats.campaignId))
      .leftJoin(whatsappSession, eq(campaigns.whatsappSessionId, whatsappSession.id))
      .where(and(
        eq(campaigns.id, params.id),
        eq(campaigns.organizationId, organizationId)
      ))
      .limit(1);

    if (!campaignData) {
      return reply.status(404).send({
        error: 'Campaign not found',
        code: 'CAMPAIGN_NOT_FOUND',
      });
    }

    return reply.send({
      success: true,
      data: campaignData,
    });
  } catch (error) {
    request.log.error(`Error getting campaign: ${error}`);
    return reply.status(500).send({
      error: 'Internal server error',
      code: 'GET_CAMPAIGN_ERROR',
    });
  }
}

export async function updateCampaign(request: FastifyRequest, reply: FastifyReply) {
  try {
    const params = request.params as { id: string };
    const body = updateCampaignSchema.parse(request.body);
    const headers = convertHeaders(request);

    const authSession = await auth.api.getSession({ headers });
    const organizationId = authSession?.session.activeOrganizationId;

    if (!organizationId) {
      return reply.status(400).send({
        error: 'Organization ID is required',
        code: 'MISSING_ORGANIZATION',
      });
    }

    // Check if campaign exists and belongs to organization
    const [existingCampaign] = await db
      .select()
      .from(campaigns)
      .where(and(
        eq(campaigns.id, params.id),
        eq(campaigns.organizationId, organizationId)
      ))
      .limit(1);

    if (!existingCampaign) {
      return reply.status(404).send({
        error: 'Campaign not found',
        code: 'CAMPAIGN_NOT_FOUND',
      });
    }

    // Don't allow updating completed or failed campaigns
    if (['completed', 'failed'].includes(existingCampaign.status)) {
      return reply.status(400).send({
        error: 'Cannot update completed or failed campaigns',
        code: 'CAMPAIGN_NOT_EDITABLE',
      });
    }

    // Validate WhatsApp session if changed
    if (body.whatsappSessionId) {
      await validateWhatsAppSession(body.whatsappSessionId, organizationId);
    }

    // Update campaign
    const [updatedCampaign] = await db
      .update(campaigns)
      .set({
        ...body,
        scheduledFor: body.scheduledFor ? new Date(body.scheduledFor) : undefined,
        recurringEndDate: body.recurringEndDate ? new Date(body.recurringEndDate) : undefined,
        updatedAt: new Date(),
      })
      .where(eq(campaigns.id, params.id))
      .returning();

    return reply.send({
      success: true,
      data: updatedCampaign,
    });
  } catch (error) {
    request.log.error(`Error updating campaign: ${error}`);
    
    if (error instanceof z.ZodError) {
      return reply.status(400).send({
        error: 'Validation failed',
        details: error.errors,
        code: 'VALIDATION_ERROR',
      });
    }

    return reply.status(500).send({
      error: error instanceof Error ? error.message : 'Internal server error',
      code: 'UPDATE_CAMPAIGN_ERROR',
    });
  }
}

export async function deleteCampaign(request: FastifyRequest, reply: FastifyReply) {
  try {
    const params = request.params as { id: string };
    const headers = convertHeaders(request);

    const authSession = await auth.api.getSession({ headers });
    const organizationId = authSession?.session.activeOrganizationId;

    if (!organizationId) {
      return reply.status(400).send({
        error: 'Organization ID is required',
        code: 'MISSING_ORGANIZATION',
      });
    }

    // Check if campaign exists and belongs to organization
    const [existingCampaign] = await db
      .select()
      .from(campaigns)
      .where(and(
        eq(campaigns.id, params.id),
        eq(campaigns.organizationId, organizationId)
      ))
      .limit(1);

    if (!existingCampaign) {
      return reply.status(404).send({
        error: 'Campaign not found',
        code: 'CAMPAIGN_NOT_FOUND',
      });
    }

    // Don't allow deleting running campaigns
    if (existingCampaign.status === 'sending') {
      return reply.status(400).send({
        error: 'Cannot delete running campaigns. Pause the campaign first.',
        code: 'CAMPAIGN_RUNNING',
      });
    }

    // Delete campaign (cascade will handle related records)
    await db.delete(campaigns).where(eq(campaigns.id, params.id));

    return reply.send({
      success: true,
      message: 'Campaign deleted successfully',
    });
  } catch (error) {
    request.log.error(`Error deleting campaign: ${error}`);
    return reply.status(500).send({
      error: 'Internal server error',
      code: 'DELETE_CAMPAIGN_ERROR',
    });
  }
}

export async function manageCampaign(request: FastifyRequest, reply: FastifyReply) {
  try {
    const params = request.params as { id: string };
    const body = campaignActionSchema.parse(request.body);
    const headers = convertHeaders(request);

    const authSession = await auth.api.getSession({ headers });
    const organizationId = authSession?.session.activeOrganizationId;

    if (!organizationId) {
      return reply.status(400).send({
        error: 'Organization ID is required',
        code: 'MISSING_ORGANIZATION',
      });
    }

    // Check if campaign exists and belongs to organization
    const [existingCampaign] = await db
      .select()
      .from(campaigns)
      .where(and(
        eq(campaigns.id, params.id),
        eq(campaigns.organizationId, organizationId)
      ))
      .limit(1);

    if (!existingCampaign) {
      return reply.status(404).send({
        error: 'Campaign not found',
        code: 'CAMPAIGN_NOT_FOUND',
      });
    }

    let updateData: Partial<typeof campaigns.$inferInsert> = {
      updatedAt: new Date(),
    };

    switch (body.action) {
      case 'start':
        if (!['draft', 'scheduled', 'paused'].includes(existingCampaign.status)) {
          return reply.status(400).send({
            error: `Cannot start campaign with status: ${existingCampaign.status}`,
            code: 'INVALID_CAMPAIGN_STATUS',
          });
        }
        updateData.status = 'sending';
        updateData.startedAt = new Date();
        updateData.pausedAt = null;
        break;

      case 'pause':
        if (existingCampaign.status !== 'sending') {
          return reply.status(400).send({
            error: 'Can only pause sending campaigns',
            code: 'INVALID_CAMPAIGN_STATUS',
          });
        }
        updateData.status = 'paused';
        updateData.pausedAt = new Date();
        break;

      case 'resume':
        if (existingCampaign.status !== 'paused') {
          return reply.status(400).send({
            error: 'Can only resume paused campaigns',
            code: 'INVALID_CAMPAIGN_STATUS',
          });
        }
        updateData.status = 'sending';
        updateData.pausedAt = null;
        break;

      case 'stop':
        if (!['sending', 'paused', 'scheduled'].includes(existingCampaign.status)) {
          return reply.status(400).send({
            error: 'Cannot stop campaign with current status',
            code: 'INVALID_CAMPAIGN_STATUS',
          });
        }
        updateData.status = 'completed';
        updateData.completedAt = new Date();
        break;
    }

    const [updatedCampaign] = await db
      .update(campaigns)
      .set(updateData)
      .where(eq(campaigns.id, params.id))
      .returning();

    return reply.send({
      success: true,
      data: updatedCampaign,
      message: `Campaign ${body.action} successfully`,
    });
  } catch (error) {
    request.log.error(`Error managing campaign: ${error}`);
    
    if (error instanceof z.ZodError) {
      return reply.status(400).send({
        error: 'Validation failed',
        details: error.errors,
        code: 'VALIDATION_ERROR',
      });
    }

    return reply.status(500).send({
      error: 'Internal server error',
      code: 'MANAGE_CAMPAIGN_ERROR',
    });
  }
}

// Campaign Templates
export async function getCampaignTemplates(request: FastifyRequest, reply: FastifyReply) {
  try {
    const headers = convertHeaders(request);
    const authSession = await auth.api.getSession({ headers });
    const organizationId = authSession?.session.activeOrganizationId;

    if (!organizationId) {
      return reply.status(400).send({
        error: 'Organization ID is required',
        code: 'MISSING_ORGANIZATION',
      });
    }

    const queryParams = request.query as {
      category?: string;
      search?: string;
    };

    const conditions = [
      and(
        eq(campaignTemplates.isActive, true),
        or(
          eq(campaignTemplates.organizationId, organizationId),
          eq(campaignTemplates.isBuiltIn, true)
        )
      )
    ];

    if (queryParams.category) {
      conditions.push(eq(campaignTemplates.category, queryParams.category));
    }

    if (queryParams.search) {
      conditions.push(
        or(
          ilike(campaignTemplates.name, `%${queryParams.search}%`),
          ilike(campaignTemplates.description, `%${queryParams.search}%`)
        )
      );
    }

    const templates = await db
      .select()
      .from(campaignTemplates)
      .where(and(...conditions))
      .orderBy(desc(campaignTemplates.usageCount), asc(campaignTemplates.name));

    return reply.send({
      success: true,
      data: templates,
    });
  } catch (error) {
    request.log.error(`Error getting campaign templates: ${error}`);
    return reply.status(500).send({
      error: 'Internal server error',
      code: 'GET_TEMPLATES_ERROR',
    });
  }
}

export async function createCampaignTemplate(request: FastifyRequest, reply: FastifyReply) {
  try {
    const body = createTemplateSchema.parse(request.body);
    const headers = convertHeaders(request);

    const authSession = await auth.api.getSession({ headers });
    const organizationId = authSession?.session.activeOrganizationId;

    if (!organizationId) {
      return reply.status(400).send({
        error: 'Organization ID is required',
        code: 'MISSING_ORGANIZATION',
      });
    }

    const templateId = createId();
    
    const [template] = await db.insert(campaignTemplates).values({
      id: templateId,
      organizationId,
      name: body.name,
      description: body.description,
      category: body.category,
      messageType: body.messageType,
      content: body.content,
      mediaUrl: body.mediaUrl,
      mediaType: body.mediaType,
      estimatedEngagement: body.estimatedEngagement,
    }).returning();

    return reply.status(201).send({
      success: true,
      data: template,
    });
  } catch (error) {
    request.log.error(`Error creating campaign template: ${error}`);
    
    if (error instanceof z.ZodError) {
      return reply.status(400).send({
        error: 'Validation failed',
        details: error.errors,
        code: 'VALIDATION_ERROR',
      });
    }

    return reply.status(500).send({
      error: 'Internal server error',
      code: 'CREATE_TEMPLATE_ERROR',
    });
  }
}