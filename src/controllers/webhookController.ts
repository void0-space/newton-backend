import { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { db } from '../db/drizzle';
import { webhook, webhookDelivery } from '../db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import { auth } from '../lib/auth';
import { convertHeaders } from '../utils/header';
import crypto from 'crypto';

// Available webhook events
export const WEBHOOK_EVENTS = [
  'message.received',
  'message.sent',
  'message.delivered',
  'message.read',
  'message.failed',
  'contact.created',
  'contact.updated',
  'contact.deleted',
  'campaign.started',
  'campaign.completed',
  'campaign.failed',
  'session.connected',
  'session.disconnected',
] as const;

// Create webhook
export async function createWebhook(request: FastifyRequest, reply: FastifyReply) {
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

    const createSchema = z.object({
      name: z.string().min(1),
      url: z.string().url(),
      events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
      secret: z.string().optional(),
      type: z.enum(['body', 'parameter']).default('body'),
      active: z.boolean().default(true),
    });

    const data = createSchema.parse(request.body);

    const webhookId = createId();
    const secret = data.secret || crypto.randomBytes(32).toString('hex');

    await db.insert(webhook).values({
      id: webhookId,
      organizationId,
      name: data.name,
      url: data.url,
      events: data.events,
      secret,
      type: data.type,
      active: data.active,
    });

    const [created] = await db.select().from(webhook).where(eq(webhook.id, webhookId));

    return reply.send({
      success: true,
      data: created,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return reply.status(400).send({
        error: 'Invalid request data',
        details: error.errors,
        code: 'VALIDATION_ERROR',
      });
    }

    request.log.error('Error creating webhook:', error);
    return reply.status(500).send({
      error: 'Failed to create webhook',
      code: 'WEBHOOK_CREATE_ERROR',
    });
  }
}

// Get all webhooks
export async function getWebhooks(request: FastifyRequest, reply: FastifyReply) {
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

    const webhooks = await db
      .select()
      .from(webhook)
      .where(eq(webhook.organizationId, organizationId))
      .orderBy(desc(webhook.createdAt));

    return reply.send({
      success: true,
      data: webhooks,
    });
  } catch (error) {
    request.log.error('Error fetching webhooks:', error);
    return reply.status(500).send({
      error: 'Failed to fetch webhooks',
      code: 'WEBHOOK_FETCH_ERROR',
    });
  }
}

// Get single webhook
export async function getWebhook(request: FastifyRequest, reply: FastifyReply) {
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

    const paramsSchema = z.object({
      id: z.string(),
    });

    const { id } = paramsSchema.parse(request.params);

    const [webhookData] = await db
      .select()
      .from(webhook)
      .where(and(eq(webhook.id, id), eq(webhook.organizationId, organizationId)));

    if (!webhookData) {
      return reply.status(404).send({
        error: 'Webhook not found',
        code: 'WEBHOOK_NOT_FOUND',
      });
    }

    return reply.send({
      success: true,
      data: webhookData,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return reply.status(400).send({
        error: 'Invalid request data',
        details: error.errors,
        code: 'VALIDATION_ERROR',
      });
    }

    request.log.error('Error fetching webhook:', error);
    return reply.status(500).send({
      error: 'Failed to fetch webhook',
      code: 'WEBHOOK_FETCH_ERROR',
    });
  }
}

// Update webhook
export async function updateWebhook(request: FastifyRequest, reply: FastifyReply) {
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

    const paramsSchema = z.object({
      id: z.string(),
    });

    const updateSchema = z.object({
      name: z.string().min(1).optional(),
      url: z.string().url().optional(),
      events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).optional(),
      secret: z.string().optional(),
      type: z.enum(['body', 'parameter']).optional(),
      active: z.boolean().optional(),
    });

    const { id } = paramsSchema.parse(request.params);
    const data = updateSchema.parse(request.body);

    const [existing] = await db
      .select()
      .from(webhook)
      .where(and(eq(webhook.id, id), eq(webhook.organizationId, organizationId)));

    if (!existing) {
      return reply.status(404).send({
        error: 'Webhook not found',
        code: 'WEBHOOK_NOT_FOUND',
      });
    }

    await db
      .update(webhook)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(webhook.id, id));

    const [updated] = await db.select().from(webhook).where(eq(webhook.id, id));

    return reply.send({
      success: true,
      data: updated,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return reply.status(400).send({
        error: 'Invalid request data',
        details: error.errors,
        code: 'VALIDATION_ERROR',
      });
    }

    request.log.error('Error updating webhook:', error);
    return reply.status(500).send({
      error: 'Failed to update webhook',
      code: 'WEBHOOK_UPDATE_ERROR',
    });
  }
}

// Delete webhook
export async function deleteWebhook(request: FastifyRequest, reply: FastifyReply) {
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

    const paramsSchema = z.object({
      id: z.string(),
    });

    const { id } = paramsSchema.parse(request.params);

    const [existing] = await db
      .select()
      .from(webhook)
      .where(and(eq(webhook.id, id), eq(webhook.organizationId, organizationId)));

    if (!existing) {
      return reply.status(404).send({
        error: 'Webhook not found',
        code: 'WEBHOOK_NOT_FOUND',
      });
    }

    await db.delete(webhook).where(eq(webhook.id, id));

    return reply.send({
      success: true,
      message: 'Webhook deleted successfully',
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return reply.status(400).send({
        error: 'Invalid request data',
        details: error.errors,
        code: 'VALIDATION_ERROR',
      });
    }

    request.log.error('Error deleting webhook:', error);
    return reply.status(500).send({
      error: 'Failed to delete webhook',
      code: 'WEBHOOK_DELETE_ERROR',
    });
  }
}

// Get webhook deliveries
export async function getWebhookDeliveries(request: FastifyRequest, reply: FastifyReply) {
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

    const paramsSchema = z.object({
      id: z.string(),
    });

    const querySchema = z.object({
      limit: z.string().transform(Number).optional(),
      offset: z.string().transform(Number).optional(),
    });

    const { id } = paramsSchema.parse(request.params);
    const { limit = 50, offset = 0 } = querySchema.parse(request.query);

    // HARD LIMIT: Prevent excessive data pulls that cause high egress
    const safeLimit = Math.min(limit, 100); // Max 100 records per request

    // Verify webhook belongs to organization
    const [webhookData] = await db
      .select()
      .from(webhook)
      .where(and(eq(webhook.id, id), eq(webhook.organizationId, organizationId)));

    if (!webhookData) {
      return reply.status(404).send({
        error: 'Webhook not found',
        code: 'WEBHOOK_NOT_FOUND',
      });
    }

    const deliveries = await db
      .select()
      .from(webhookDelivery)
      .where(eq(webhookDelivery.webhookId, id))
      .orderBy(desc(webhookDelivery.createdAt))
      .limit(safeLimit) // Use safe limit instead of raw limit
      .offset(offset);

    // Log endpoint usage for monitoring
    request.log.info(
      {
        endpoint: 'getWebhookDeliveries',
        webhookId: id,
        requestedLimit: limit,
        safeLimit,
        offset,
        resultCount: deliveries.length,
        organizationId,
      },
      'Webhook deliveries fetched'
    );

    return reply.send({
      success: true,
      data: deliveries,
      meta: {
        limit: safeLimit,
        offset,
        count: deliveries.length,
        // Note: If count equals safeLimit, there may be more records available
        hasMore: deliveries.length === safeLimit,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return reply.status(400).send({
        error: 'Invalid request data',
        details: error.errors,
        code: 'VALIDATION_ERROR',
      });
    }

    request.log.error('Error fetching webhook deliveries:', error);
    return reply.status(500).send({
      error: 'Failed to fetch webhook deliveries',
      code: 'WEBHOOK_DELIVERIES_FETCH_ERROR',
    });
  }
}

// Test webhook
export async function testWebhook(request: FastifyRequest, reply: FastifyReply) {
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

    const paramsSchema = z.object({
      id: z.string(),
    });

    const { id } = paramsSchema.parse(request.params);

    const [webhookData] = await db
      .select()
      .from(webhook)
      .where(and(eq(webhook.id, id), eq(webhook.organizationId, organizationId)));

    if (!webhookData) {
      return reply.status(404).send({
        error: 'Webhook not found',
        code: 'WEBHOOK_NOT_FOUND',
      });
    }

    // Send test payload
    const testPayload = {
      event: 'webhook.test',
      timestamp: new Date().toISOString(),
      data: {
        message: 'This is a test webhook delivery',
      },
    };

    const deliveryId = createId();

    try {
      const signature = crypto
        .createHmac('sha256', webhookData.secret || '')
        .update(JSON.stringify(testPayload))
        .digest('hex');

      const response = await fetch(webhookData.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': signature,
          'X-Webhook-Event': 'webhook.test',
        },
        body: JSON.stringify(testPayload),
      });

      const responseBody = await response.text();

      await db.insert(webhookDelivery).values({
        id: deliveryId,
        webhookId: webhookData.id,
        event: 'webhook.test',
        payload: JSON.stringify(testPayload),
        status: response.ok ? 'success' : 'failed',
        attempts: '1',
        lastAttemptAt: new Date(),
        responseStatus: response.status.toString(),
        responseBody: responseBody.substring(0, 1000), // Limit response body size
      });

      return reply.send({
        success: response.ok,
        data: {
          status: response.status,
          statusText: response.statusText,
          responseBody: responseBody.substring(0, 500),
        },
      });
    } catch (error: any) {
      await db.insert(webhookDelivery).values({
        id: deliveryId,
        webhookId: webhookData.id,
        event: 'webhook.test',
        payload: JSON.stringify(testPayload),
        status: 'failed',
        attempts: '1',
        lastAttemptAt: new Date(),
        responseBody: error.message,
      });

      return reply.status(500).send({
        success: false,
        error: 'Webhook delivery failed',
        details: error.message,
      });
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return reply.status(400).send({
        error: 'Invalid request data',
        details: error.errors,
        code: 'VALIDATION_ERROR',
      });
    }

    request.log.error('Error testing webhook:', error);
    return reply.status(500).send({
      error: 'Failed to test webhook',
      code: 'WEBHOOK_TEST_ERROR',
    });
  }
}

// Get available events
export async function getWebhookEvents(request: FastifyRequest, reply: FastifyReply) {
  return reply.send({
    success: true,
    data: WEBHOOK_EVENTS,
  });
}
