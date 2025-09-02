import { FastifyRequest, FastifyReply } from 'fastify';
import { BillingService } from '../services/billingService';
import { db } from '../db/drizzle';
import { plan, subscription, invoice, payment, usage } from '../db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { z } from 'zod';

const createPlanSchema = z.object({
  name: z.string().min(1, 'Plan name is required'),
  description: z.string().optional(),
  monthlyPrice: z.number().min(0, 'Price must be non-negative'),
  includedMessages: z.number().min(0, 'Included messages must be non-negative'),
  maxSessions: z.number().min(1, 'Max sessions must be at least 1'),
  features: z.array(z.string()).default([]),
});

const updatePlanSchema = createPlanSchema.partial();

const createSubscriptionSchema = z.object({
  planId: z.string().min(1, 'Plan ID is required'),
  trialDays: z.number().min(0).max(30).optional(),
});

const webhookSchema = z.object({
  entity: z.string(),
  account_id: z.string(),
  event: z.string(),
  contains: z.array(z.string()),
  payload: z.any(),
  created_at: z.number(),
});

declare module 'fastify' {
  interface FastifyInstance {
    billing: BillingService;
  }
}

// Admin Plan Management
export async function createPlan(request: FastifyRequest, reply: FastifyReply) {
  try {
    // Verify admin role
    if (!request.user || request.user.role !== 'admin') {
      return reply.status(403).send({
        error: 'Admin access required',
        code: 'ADMIN_REQUIRED',
      });
    }

    const planData = createPlanSchema.parse(request.body);
    const createdPlan = await request.server.billing.createPlan(planData);

    return reply.status(201).send({
      success: true,
      data: createdPlan,
    });
  } catch (error) {
    request.log.error('Error creating plan: ' + (error instanceof Error ? error.message : String(error)));
    return reply.status(500).send({
      error: 'Failed to create plan',
      code: 'CREATE_PLAN_FAILED',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

export async function listPlans(request: FastifyRequest, reply: FastifyReply) {
  try {
    const { active } = request.query as { active?: string };
    
    let whereClause = undefined;
    if (active !== undefined) {
      whereClause = eq(plan.active, active === 'true');
    }

    const plans = await db
      .select()
      .from(plan)
      .where(whereClause)
      .orderBy(desc(plan.createdAt));

    return reply.send({
      success: true,
      data: plans,
    });
  } catch (error) {
    request.log.error('Error listing plans: ' + (error instanceof Error ? error.message : String(error)));
    return reply.status(500).send({
      error: 'Failed to list plans',
      code: 'LIST_PLANS_FAILED',
    });
  }
}

export async function getPlan(request: FastifyRequest, reply: FastifyReply) {
  try {
    const { id } = request.params as { id: string };

    const [planData] = await db
      .select()
      .from(plan)
      .where(eq(plan.id, id))
      .limit(1);

    if (!planData) {
      return reply.status(404).send({
        error: 'Plan not found',
        code: 'PLAN_NOT_FOUND',
      });
    }

    return reply.send({
      success: true,
      data: planData,
    });
  } catch (error) {
    request.log.error('Error fetching plan: ' + (error instanceof Error ? error.message : String(error)));
    return reply.status(500).send({
      error: 'Failed to fetch plan',
      code: 'FETCH_PLAN_FAILED',
    });
  }
}

export async function updatePlan(request: FastifyRequest, reply: FastifyReply) {
  try {
    // Verify admin role
    if (!request.user || request.user.role !== 'admin') {
      return reply.status(403).send({
        error: 'Admin access required',
        code: 'ADMIN_REQUIRED',
      });
    }

    const { id } = request.params as { id: string };
    const updates = updatePlanSchema.parse(request.body);

    const updatedPlan = await request.server.billing.updatePlan(id, updates);

    return reply.send({
      success: true,
      data: updatedPlan,
    });
  } catch (error) {
    request.log.error('Error updating plan: ' + (error instanceof Error ? error.message : String(error)));
    return reply.status(500).send({
      error: 'Failed to update plan',
      code: 'UPDATE_PLAN_FAILED',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

export async function deactivatePlan(request: FastifyRequest, reply: FastifyReply) {
  try {
    // Verify admin role
    if (!request.user || request.user.role !== 'admin') {
      return reply.status(403).send({
        error: 'Admin access required',
        code: 'ADMIN_REQUIRED',
      });
    }

    const { id } = request.params as { id: string };

    const [updatedPlan] = await db
      .update(plan)
      .set({
        active: false,
        updatedAt: new Date(),
      })
      .where(eq(plan.id, id))
      .returning();

    if (!updatedPlan) {
      return reply.status(404).send({
        error: 'Plan not found',
        code: 'PLAN_NOT_FOUND',
      });
    }

    return reply.send({
      success: true,
      data: updatedPlan,
      message: 'Plan deactivated successfully',
    });
  } catch (error) {
    request.log.error('Error deactivating plan: ' + (error instanceof Error ? error.message : String(error)));
    return reply.status(500).send({
      error: 'Failed to deactivate plan',
      code: 'DEACTIVATE_PLAN_FAILED',
    });
  }
}

// Tenant Subscription Management
export async function createSubscription(request: FastifyRequest, reply: FastifyReply) {
  try {
    if (!request.organization) {
      return reply.status(400).send({
        error: 'Organization context required',
        code: 'ORGANIZATION_REQUIRED',
      });
    }

    const { planId, trialDays } = createSubscriptionSchema.parse(request.body);

    // Check if organization already has an active subscription
    const [existingSubscription] = await db
      .select()
      .from(subscription)
      .where(and(
        eq(subscription.organizationId, request.organization.id),
        eq(subscription.status, 'active')
      ))
      .limit(1);

    if (existingSubscription) {
      return reply.status(409).send({
        error: 'Organization already has an active subscription',
        code: 'SUBSCRIPTION_EXISTS',
      });
    }

    const createdSubscription = await request.server.billing.createSubscription({
      organizationId: request.organization.id,
      planId,
      trialDays,
    });

    return reply.status(201).send({
      success: true,
      data: createdSubscription,
    });
  } catch (error) {
    request.log.error('Error creating subscription: ' + (error instanceof Error ? error.message : String(error)));
    return reply.status(500).send({
      error: 'Failed to create subscription',
      code: 'CREATE_SUBSCRIPTION_FAILED',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

export async function getSubscription(request: FastifyRequest, reply: FastifyReply) {
  try {
    if (!request.organization) {
      return reply.status(400).send({
        error: 'Organization context required',
        code: 'ORGANIZATION_REQUIRED',
      });
    }

    const [subscriptionData] = await db
      .select({
        subscription: subscription,
        plan: plan,
      })
      .from(subscription)
      .innerJoin(plan, eq(subscription.planId, plan.id))
      .where(eq(subscription.organizationId, request.organization.id))
      .orderBy(desc(subscription.createdAt))
      .limit(1);

    if (!subscriptionData) {
      return reply.status(404).send({
        error: 'No subscription found',
        code: 'SUBSCRIPTION_NOT_FOUND',
      });
    }

    return reply.send({
      success: true,
      data: {
        ...subscriptionData.subscription,
        plan: subscriptionData.plan,
      },
    });
  } catch (error) {
    request.log.error('Error fetching subscription: ' + (error instanceof Error ? error.message : String(error)));
    return reply.status(500).send({
      error: 'Failed to fetch subscription',
      code: 'FETCH_SUBSCRIPTION_FAILED',
    });
  }
}

export async function activateSubscription(request: FastifyRequest, reply: FastifyReply) {
  try {
    if (!request.organization) {
      return reply.status(400).send({
        error: 'Organization context required',
        code: 'ORGANIZATION_REQUIRED',
      });
    }

    // Get the trial subscription
    const [trialSubscription] = await db
      .select()
      .from(subscription)
      .where(and(
        eq(subscription.organizationId, request.organization.id),
        eq(subscription.status, 'trial')
      ))
      .limit(1);

    if (!trialSubscription) {
      return reply.status(404).send({
        error: 'No trial subscription found',
        code: 'TRIAL_NOT_FOUND',
      });
    }

    // Create Razorpay subscription
    const result = await request.server.billing.createRazorpaySubscription(trialSubscription.id);

    return reply.send({
      success: true,
      data: result.subscription,
      razorpaySubscription: {
        id: result.razorpaySubscription.id,
        status: result.razorpaySubscription.status,
        short_url: result.razorpaySubscription.short_url,
      },
    });
  } catch (error) {
    request.log.error('Error activating subscription: ' + (error instanceof Error ? error.message : String(error)));
    return reply.status(500).send({
      error: 'Failed to activate subscription',
      code: 'ACTIVATE_SUBSCRIPTION_FAILED',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

export async function cancelSubscription(request: FastifyRequest, reply: FastifyReply) {
  try {
    if (!request.organization) {
      return reply.status(400).send({
        error: 'Organization context required',
        code: 'ORGANIZATION_REQUIRED',
      });
    }

    const { immediate } = request.query as { immediate?: string };
    const cancelImmediately = immediate === 'true';

    const [activeSubscription] = await db
      .select()
      .from(subscription)
      .where(and(
        eq(subscription.organizationId, request.organization.id),
        eq(subscription.status, 'active')
      ))
      .limit(1);

    if (!activeSubscription) {
      return reply.status(404).send({
        error: 'No active subscription found',
        code: 'SUBSCRIPTION_NOT_FOUND',
      });
    }

    const cancelledSubscription = await request.server.billing.cancelSubscription(
      activeSubscription.id,
      !cancelImmediately
    );

    return reply.send({
      success: true,
      data: cancelledSubscription,
      message: cancelImmediately 
        ? 'Subscription cancelled immediately'
        : 'Subscription will be cancelled at the end of current period',
    });
  } catch (error) {
    request.log.error('Error cancelling subscription: ' + (error instanceof Error ? error.message : String(error)));
    return reply.status(500).send({
      error: 'Failed to cancel subscription',
      code: 'CANCEL_SUBSCRIPTION_FAILED',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

export async function getUsage(request: FastifyRequest, reply: FastifyReply) {
  try {
    if (!request.organization) {
      return reply.status(400).send({
        error: 'Organization context required',
        code: 'ORGANIZATION_REQUIRED',
      });
    }

    const { period } = request.query as { period?: string };
    const targetPeriod = period || new Date().toISOString().slice(0, 7); // Current month if not specified

    const [usageData] = await db
      .select()
      .from(usage)
      .where(and(
        eq(usage.organizationId, request.organization.id),
        eq(usage.period, targetPeriod)
      ))
      .limit(1);

    // Get quota information
    const messageQuota = await request.server.billing.checkUsageQuota(
      request.organization.id, 
      'messages'
    );
    const sessionQuota = await request.server.billing.checkUsageQuota(
      request.organization.id,
      'sessions'
    );

    return reply.send({
      success: true,
      data: {
        period: targetPeriod,
        usage: usageData || {
          messagesSent: 0,
          messagesReceived: 0,
          mediaSent: 0,
          storageUsed: 0,
        },
        quotas: {
          messages: messageQuota,
          sessions: sessionQuota,
        },
      },
    });
  } catch (error) {
    request.log.error('Error fetching usage: ' + (error instanceof Error ? error.message : String(error)));
    return reply.status(500).send({
      error: 'Failed to fetch usage',
      code: 'FETCH_USAGE_FAILED',
    });
  }
}

export async function getBillingHistory(request: FastifyRequest, reply: FastifyReply) {
  try {
    if (!request.organization) {
      return reply.status(400).send({
        error: 'Organization context required',
        code: 'ORGANIZATION_REQUIRED',
      });
    }

    const { limit = 20, offset = 0 } = request.query as {
      limit?: number;
      offset?: number;
    };

    // Get invoices
    const invoices = await db
      .select()
      .from(invoice)
      .where(eq(invoice.organizationId, request.organization.id))
      .orderBy(desc(invoice.createdAt))
      .limit(limit)
      .offset(offset);

    // Get payments
    const payments = await db
      .select()
      .from(payment)
      .where(eq(payment.organizationId, request.organization.id))
      .orderBy(desc(payment.createdAt))
      .limit(limit)
      .offset(offset);

    return reply.send({
      success: true,
      data: {
        invoices,
        payments,
        pagination: {
          limit,
          offset,
          hasMore: invoices.length === limit || payments.length === limit,
        },
      },
    });
  } catch (error) {
    request.log.error('Error fetching billing history: ' + (error instanceof Error ? error.message : String(error)));
    return reply.status(500).send({
      error: 'Failed to fetch billing history',
      code: 'FETCH_BILLING_FAILED',
    });
  }
}

// Webhook Handler
export async function handleRazorpayWebhook(request: FastifyRequest, reply: FastifyReply) {
  try {
    const signature = request.headers['x-razorpay-signature'] as string;
    const webhookData = webhookSchema.parse(request.body);

    await request.server.billing.handleWebhook(webhookData, signature);

    return reply.send({ success: true });
  } catch (error) {
    request.log.error('Error handling Razorpay webhook: ' + (error instanceof Error ? error.message : String(error)));
    return reply.status(400).send({
      error: 'Webhook processing failed',
      code: 'WEBHOOK_FAILED',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}