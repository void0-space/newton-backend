import { pgTable, text, timestamp, integer, numeric, boolean } from 'drizzle-orm/pg-core';
import { organization } from './auth';

export const plan = pgTable('plan', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  monthlyPrice: numeric('monthly_price', { precision: 10, scale: 2 }).notNull(),
  includedMessages: integer('included_messages').notNull().default(0),
  maxSessions: integer('max_sessions').notNull().default(1),
  features: text('features').array(), // array of feature strings
  razorpayPlanId: text('razorpay_plan_id'),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const subscription = pgTable('subscription', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organization.id, { onDelete: 'cascade' }),
  planId: text('plan_id')
    .notNull()
    .references(() => plan.id),
  razorpaySubscriptionId: text('razorpay_subscription_id'),
  status: text('status').notNull().default('trial'), // trial, active, past_due, canceled, unpaid
  currentPeriodStart: timestamp('current_period_start'),
  currentPeriodEnd: timestamp('current_period_end'),
  trialStart: timestamp('trial_start'),
  trialEnd: timestamp('trial_end'),
  canceledAt: timestamp('canceled_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const usage = pgTable('usage', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organization.id, { onDelete: 'cascade' }),
  subscriptionId: text('subscription_id')
    .references(() => subscription.id, { onDelete: 'cascade' }),
  period: text('period').notNull(), // YYYY-MM format
  messagesSent: integer('messages_sent').notNull().default(0),
  messagesReceived: integer('messages_received').notNull().default(0),
  mediaSent: integer('media_sent').notNull().default(0),
  storageUsed: integer('storage_used').notNull().default(0), // in bytes
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const invoice = pgTable('invoice', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organization.id, { onDelete: 'cascade' }),
  subscriptionId: text('subscription_id')
    .references(() => subscription.id),
  razorpayInvoiceId: text('razorpay_invoice_id'),
  amount: numeric('amount', { precision: 10, scale: 2 }).notNull(),
  currency: text('currency').notNull().default('INR'),
  status: text('status').notNull().default('pending'), // pending, paid, failed
  dueDate: timestamp('due_date').notNull(),
  paidAt: timestamp('paid_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const payment = pgTable('payment', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organization.id, { onDelete: 'cascade' }),
  invoiceId: text('invoice_id')
    .references(() => invoice.id),
  razorpayPaymentId: text('razorpay_payment_id').notNull(),
  amount: numeric('amount', { precision: 10, scale: 2 }).notNull(),
  currency: text('currency').notNull().default('INR'),
  status: text('status').notNull(), // authorized, captured, failed
  method: text('method'), // card, upi, netbanking, etc.
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});