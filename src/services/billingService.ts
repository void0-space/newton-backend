import Razorpay from 'razorpay';
import { FastifyInstance } from 'fastify';
import { db } from '../db/drizzle';
import { plan, subscription, invoice, payment, usage, organization } from '../db/schema';
import { eq, and, desc, gte, lte } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import crypto from 'crypto';

export interface CreatePlanOptions {
  name: string;
  description?: string;
  monthlyPrice: number;
  includedMessages: number;
  maxSessions: number;
  features: string[];
}

export interface SubscriptionOptions {
  organizationId: string;
  planId: string;
  trialDays?: number;
}

export interface WebhookPayload {
  entity: string;
  account_id: string;
  event: string;
  contains: string[];
  payload: any;
  created_at: number;
}

export class BillingService {
  private razorpay: Razorpay;
  private fastify: FastifyInstance;
  private webhookSecret: string;

  constructor(fastify: FastifyInstance) {
    this.fastify = fastify;
    this.webhookSecret = process.env.RZP_WEBHOOK_SECRET || '';
    
    if (!process.env.RZP_KEY_ID || !process.env.RZP_KEY_SECRET) {
      throw new Error('Razorpay credentials not configured');
    }

    this.razorpay = new Razorpay({
      key_id: process.env.RZP_KEY_ID,
      key_secret: process.env.RZP_KEY_SECRET,
    });
  }

  async createPlan(planData: CreatePlanOptions): Promise<any> {
    try {
      // Create plan on Razorpay
      const razorpayPlan = await this.razorpay.plans.create({
        period: 'monthly',
        interval: 1,
        item: {
          name: planData.name,
          description: planData.description || '',
          amount: Math.round(planData.monthlyPrice * 100), // Convert to paise
          currency: 'INR',
        },
        notes: {
          includedMessages: planData.includedMessages.toString(),
          maxSessions: planData.maxSessions.toString(),
          features: JSON.stringify(planData.features),
        },
      });

      // Save plan to database
      const [savedPlan] = await db.insert(plan).values({
        id: createId(),
        name: planData.name,
        description: planData.description,
        monthlyPrice: planData.monthlyPrice.toString(),
        includedMessages: planData.includedMessages,
        maxSessions: planData.maxSessions,
        features: planData.features,
        razorpayPlanId: razorpayPlan.id,
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }).returning();

      this.fastify.log.info(`Plan created: ${savedPlan.id} -> ${razorpayPlan.id}`);
      return savedPlan;
    } catch (error) {
      this.fastify.log.error('Error creating plan: ' + (error instanceof Error ? error.message : String(error)));
      throw error;
    }
  }

  async updatePlan(planId: string, updates: Partial<CreatePlanOptions>): Promise<any> {
    try {
      const [existingPlan] = await db
        .select()
        .from(plan)
        .where(eq(plan.id, planId))
        .limit(1);

      if (!existingPlan) {
        throw new Error('Plan not found');
      }

      // Update plan in database
      const [updatedPlan] = await db
        .update(plan)
        .set({
          ...updates,
          monthlyPrice: updates.monthlyPrice?.toString(),
          updatedAt: new Date(),
        })
        .where(eq(plan.id, planId))
        .returning();

      // Note: Razorpay plans are immutable, so we can't update them
      // In production, you might want to create a new plan version
      this.fastify.log.info(`Plan updated: ${planId}`);
      return updatedPlan;
    } catch (error) {
      this.fastify.log.error('Error updating plan: ' + (error instanceof Error ? error.message : String(error)));
      throw error;
    }
  }

  async createSubscription(options: SubscriptionOptions): Promise<any> {
    try {
      const { organizationId, planId, trialDays = 7 } = options;

      // Get plan details
      const [planData] = await db
        .select()
        .from(plan)
        .where(eq(plan.id, planId))
        .limit(1);

      if (!planData || !planData.razorpayPlanId) {
        throw new Error('Plan not found or not configured with Razorpay');
      }

      // Calculate trial period
      const trialStart = new Date();
      const trialEnd = new Date();
      trialEnd.setDate(trialStart.getDate() + trialDays);

      // Create subscription in database first (trial period)
      const [dbSubscription] = await db.insert(subscription).values({
        id: createId(),
        organizationId,
        planId,
        status: 'trial',
        trialStart,
        trialEnd,
        createdAt: new Date(),
        updatedAt: new Date(),
      }).returning();

      // Initialize usage tracking for current period
      await this.initializeUsageTracking(organizationId, dbSubscription.id);

      this.fastify.log.info(`Subscription created: ${dbSubscription.id} (trial)`);
      return dbSubscription;
    } catch (error) {
      this.fastify.log.error('Error creating subscription: ' + (error instanceof Error ? error.message : String(error)));
      throw error;
    }
  }

  async createRazorpaySubscription(subscriptionId: string): Promise<any> {
    try {
      // Get subscription and plan details
      const [sub] = await db
        .select({
          subscription: subscription,
          plan: plan,
          organization: organization,
        })
        .from(subscription)
        .innerJoin(plan, eq(subscription.planId, plan.id))
        .innerJoin(organization, eq(subscription.organizationId, organization.id))
        .where(eq(subscription.id, subscriptionId))
        .limit(1);

      if (!sub) {
        throw new Error('Subscription not found');
      }

      // Create subscription on Razorpay (this will start after trial)
      const razorpaySubscription = await this.razorpay.subscriptions.create({
        plan_id: sub.plan.razorpayPlanId!,
        quantity: 1,
        total_count: 0, // Unlimited billing cycles
        start_at: Math.floor(sub.subscription.trialEnd!.getTime() / 1000), // Start after trial
        customer_notify: 1,
        notes: {
          organizationId: sub.organization.id,
          organizationName: sub.organization.name,
          subscriptionId: sub.subscription.id,
        },
      });

      // Update subscription with Razorpay ID
      const [updatedSubscription] = await db
        .update(subscription)
        .set({
          razorpaySubscriptionId: razorpaySubscription.id,
          updatedAt: new Date(),
        })
        .where(eq(subscription.id, subscriptionId))
        .returning();

      this.fastify.log.info(`Razorpay subscription created: ${razorpaySubscription.id}`);
      return { subscription: updatedSubscription, razorpaySubscription };
    } catch (error) {
      this.fastify.log.error('Error creating Razorpay subscription: ' + (error instanceof Error ? error.message : String(error)));
      throw error;
    }
  }

  async cancelSubscription(subscriptionId: string, cancelAtPeriodEnd = true): Promise<any> {
    try {
      const [sub] = await db
        .select()
        .from(subscription)
        .where(eq(subscription.id, subscriptionId))
        .limit(1);

      if (!sub) {
        throw new Error('Subscription not found');
      }

      // Cancel on Razorpay if it exists
      if (sub.razorpaySubscriptionId) {
        await this.razorpay.subscriptions.cancel(sub.razorpaySubscriptionId, {
          cancel_at_cycle_end: cancelAtPeriodEnd ? 1 : 0,
        });
      }

      // Update subscription status
      const [updatedSubscription] = await db
        .update(subscription)
        .set({
          status: cancelAtPeriodEnd ? 'cancelled' : 'canceled',
          canceledAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(subscription.id, subscriptionId))
        .returning();

      this.fastify.log.info(`Subscription cancelled: ${subscriptionId}`);
      return updatedSubscription;
    } catch (error) {
      this.fastify.log.error('Error cancelling subscription: ' + (error instanceof Error ? error.message : String(error)));
      throw error;
    }
  }

  async handleWebhook(payload: WebhookPayload, signature: string): Promise<void> {
    try {
      // Verify webhook signature
      if (this.webhookSecret && !this.verifyWebhookSignature(JSON.stringify(payload), signature)) {
        throw new Error('Invalid webhook signature');
      }

      const { event, payload: webhookData } = payload;

      this.fastify.log.info(`Processing Razorpay webhook: ${event}`);

      switch (event) {
        case 'subscription.activated':
          await this.handleSubscriptionActivated(webhookData.subscription);
          break;

        case 'subscription.charged':
          await this.handleSubscriptionCharged(webhookData.payment, webhookData.subscription);
          break;

        case 'subscription.cancelled':
          await this.handleSubscriptionCancelled(webhookData.subscription);
          break;

        case 'subscription.paused':
          await this.handleSubscriptionPaused(webhookData.subscription);
          break;

        case 'subscription.resumed':
          await this.handleSubscriptionResumed(webhookData.subscription);
          break;

        case 'payment.authorized':
          await this.handlePaymentAuthorized(webhookData.payment);
          break;

        case 'payment.captured':
          await this.handlePaymentCaptured(webhookData.payment);
          break;

        case 'payment.failed':
          await this.handlePaymentFailed(webhookData.payment);
          break;

        case 'invoice.paid':
          await this.handleInvoicePaid(webhookData.invoice);
          break;

        default:
          this.fastify.log.info(`Unhandled webhook event: ${event}`);
      }
    } catch (error) {
      this.fastify.log.error('Error handling webhook: ' + (error instanceof Error ? error.message : String(error)));
      throw error;
    }
  }

  private async handleSubscriptionActivated(razorpaySubscription: any): Promise<void> {
    const subscriptionId = razorpaySubscription.notes?.subscriptionId;
    
    if (!subscriptionId) {
      this.fastify.log.warn('Subscription activated without internal subscription ID');
      return;
    }

    await db
      .update(subscription)
      .set({
        status: 'active',
        currentPeriodStart: new Date(razorpaySubscription.current_start * 1000),
        currentPeriodEnd: new Date(razorpaySubscription.current_end * 1000),
        updatedAt: new Date(),
      })
      .where(eq(subscription.id, subscriptionId));

    this.fastify.log.info(`Subscription activated: ${subscriptionId}`);
  }

  private async handleSubscriptionCharged(razorpayPayment: any, razorpaySubscription: any): Promise<void> {
    const subscriptionId = razorpaySubscription.notes?.subscriptionId;
    const organizationId = razorpaySubscription.notes?.organizationId;

    if (!subscriptionId || !organizationId) {
      this.fastify.log.warn('Subscription charged without required metadata');
      return;
    }

    // Create payment record
    await db.insert(payment).values({
      id: createId(),
      organizationId,
      razorpayPaymentId: razorpayPayment.id,
      amount: (razorpayPayment.amount / 100).toString(), // Convert from paise
      currency: razorpayPayment.currency,
      status: razorpayPayment.status,
      method: razorpayPayment.method,
      createdAt: new Date(razorpayPayment.created_at * 1000),
      updatedAt: new Date(),
    });

    // Update subscription period
    await db
      .update(subscription)
      .set({
        currentPeriodStart: new Date(razorpaySubscription.current_start * 1000),
        currentPeriodEnd: new Date(razorpaySubscription.current_end * 1000),
        updatedAt: new Date(),
      })
      .where(eq(subscription.id, subscriptionId));

    this.fastify.log.info(`Payment recorded for subscription: ${subscriptionId}`);
  }

  private async handleSubscriptionCancelled(razorpaySubscription: any): Promise<void> {
    const subscriptionId = razorpaySubscription.notes?.subscriptionId;
    
    if (!subscriptionId) return;

    await db
      .update(subscription)
      .set({
        status: 'canceled',
        canceledAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(subscription.id, subscriptionId));
  }

  private async handleSubscriptionPaused(razorpaySubscription: any): Promise<void> {
    const subscriptionId = razorpaySubscription.notes?.subscriptionId;
    
    if (!subscriptionId) return;

    await db
      .update(subscription)
      .set({
        status: 'paused',
        updatedAt: new Date(),
      })
      .where(eq(subscription.id, subscriptionId));
  }

  private async handleSubscriptionResumed(razorpaySubscription: any): Promise<void> {
    const subscriptionId = razorpaySubscription.notes?.subscriptionId;
    
    if (!subscriptionId) return;

    await db
      .update(subscription)
      .set({
        status: 'active',
        updatedAt: new Date(),
      })
      .where(eq(subscription.id, subscriptionId));
  }

  private async handlePaymentAuthorized(razorpayPayment: any): Promise<void> {
    // Update payment status if exists
    await this.updatePaymentStatus(razorpayPayment.id, 'authorized');
  }

  private async handlePaymentCaptured(razorpayPayment: any): Promise<void> {
    await this.updatePaymentStatus(razorpayPayment.id, 'captured');
  }

  private async handlePaymentFailed(razorpayPayment: any): Promise<void> {
    await this.updatePaymentStatus(razorpayPayment.id, 'failed');
  }

  private async handleInvoicePaid(razorpayInvoice: any): Promise<void> {
    // Update invoice status
    await db
      .update(invoice)
      .set({
        status: 'paid',
        paidAt: new Date(razorpayInvoice.paid_at * 1000),
        updatedAt: new Date(),
      })
      .where(eq(invoice.razorpayInvoiceId, razorpayInvoice.id));
  }

  private async updatePaymentStatus(razorpayPaymentId: string, status: string): Promise<void> {
    await db
      .update(payment)
      .set({
        status,
        updatedAt: new Date(),
      })
      .where(eq(payment.razorpayPaymentId, razorpayPaymentId));
  }

  private verifyWebhookSignature(body: string, signature: string): boolean {
    if (!this.webhookSecret) return true; // Skip verification in development

    const expectedSignature = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(body)
      .digest('hex');

    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  }

  async trackUsage(
    organizationId: string,
    type: 'messages_sent' | 'messages_received' | 'media_sent' | 'storage_used',
    amount: number = 1
  ): Promise<void> {
    try {
      const period = new Date().toISOString().slice(0, 7); // YYYY-MM format

      // Get or create usage record
      const [existingUsage] = await db
        .select()
        .from(usage)
        .where(and(
          eq(usage.organizationId, organizationId),
          eq(usage.period, period)
        ))
        .limit(1);

      if (existingUsage) {
        // Update existing usage
        const updateData: any = { updatedAt: new Date() };
        updateData[type] = existingUsage[type as keyof typeof existingUsage] + amount;

        await db
          .update(usage)
          .set(updateData)
          .where(eq(usage.id, existingUsage.id));
      } else {
        // Create new usage record
        const usageData: any = {
          id: createId(),
          organizationId,
          period,
          messagesSent: 0,
          messagesReceived: 0,
          mediaSent: 0,
          storageUsed: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        usageData[type] = amount;

        await db.insert(usage).values(usageData);
      }

      this.fastify.log.debug(`Usage tracked: ${organizationId} ${type} +${amount}`);
    } catch (error) {
      this.fastify.log.error('Error tracking usage: ' + (error instanceof Error ? error.message : String(error)));
    }
  }

  async checkUsageQuota(organizationId: string, type: 'messages' | 'sessions' | 'storage'): Promise<{
    allowed: boolean;
    current: number;
    limit: number;
    percentage: number;
  }> {
    try {
      // Get organization's current subscription and plan
      const [subData] = await db
        .select({
          subscription: subscription,
          plan: plan,
        })
        .from(subscription)
        .innerJoin(plan, eq(subscription.planId, plan.id))
        .where(and(
          eq(subscription.organizationId, organizationId),
          eq(subscription.status, 'active')
        ))
        .limit(1);

      if (!subData) {
        // No active subscription, check trial
        const [trialSub] = await db
          .select({
            subscription: subscription,
            plan: plan,
          })
          .from(subscription)
          .innerJoin(plan, eq(subscription.planId, plan.id))
          .where(and(
            eq(subscription.organizationId, organizationId),
            eq(subscription.status, 'trial')
          ))
          .limit(1);

        if (!trialSub || new Date() > trialSub.subscription.trialEnd!) {
          return { allowed: false, current: 0, limit: 0, percentage: 100 };
        }
        subData = trialSub;
      }

      const currentPeriod = new Date().toISOString().slice(0, 7);
      const [currentUsage] = await db
        .select()
        .from(usage)
        .where(and(
          eq(usage.organizationId, organizationId),
          eq(usage.period, currentPeriod)
        ))
        .limit(1);

      let current = 0;
      let limit = 0;

      switch (type) {
        case 'messages':
          current = (currentUsage?.messagesSent || 0) + (currentUsage?.messagesReceived || 0);
          limit = subData.plan.includedMessages;
          break;
        case 'sessions':
          // This would need to be implemented based on active sessions count
          current = 0; // TODO: Get active sessions count
          limit = subData.plan.maxSessions;
          break;
        case 'storage':
          current = currentUsage?.storageUsed || 0;
          limit = 1024 * 1024 * 1024; // 1GB default
          break;
      }

      const percentage = limit > 0 ? (current / limit) * 100 : 0;
      const allowed = current < limit;

      return { allowed, current, limit, percentage };
    } catch (error) {
      this.fastify.log.error('Error checking usage quota: ' + (error instanceof Error ? error.message : String(error)));
      return { allowed: true, current: 0, limit: Infinity, percentage: 0 };
    }
  }

  private async initializeUsageTracking(organizationId: string, subscriptionId: string): Promise<void> {
    const period = new Date().toISOString().slice(0, 7);
    
    try {
      await db.insert(usage).values({
        id: createId(),
        organizationId,
        subscriptionId,
        period,
        messagesSent: 0,
        messagesReceived: 0,
        mediaSent: 0,
        storageUsed: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    } catch (error) {
      // Ignore if already exists
      this.fastify.log.debug('Usage tracking already initialized for this period');
    }
  }
}