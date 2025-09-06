import { pgTable, text, timestamp, boolean, integer, jsonb, pgEnum } from 'drizzle-orm/pg-core';
import { organization } from './auth';
import { whatsappSession } from './whatsapp';

// Enums for campaign fields
export const campaignStatusEnum = pgEnum('campaign_status', [
  'draft', 'scheduled', 'sending', 'completed', 'failed', 'paused'
]);

export const campaignPriorityEnum = pgEnum('campaign_priority', [
  'low', 'normal', 'high'
]);

export const messageTypeEnum = pgEnum('message_type', [
  'text', 'media', 'template'
]);

export const mediaTypeEnum = pgEnum('media_type', [
  'image', 'video', 'audio', 'document'
]);

export const recipientTypeEnum = pgEnum('recipient_type', [
  'all', 'groups', 'individual', 'csv_upload'
]);

export const schedulingTypeEnum = pgEnum('scheduling_type', [
  'immediate', 'scheduled', 'recurring'
]);

export const recurringFrequencyEnum = pgEnum('recurring_frequency', [
  'daily', 'weekly', 'monthly'
]);

// Main campaigns table
export const campaigns = pgTable('campaigns', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organization.id, { onDelete: 'cascade' }),
  whatsappSessionId: text('whatsapp_session_id')
    .notNull()
    .references(() => whatsappSession.id, { onDelete: 'cascade' }),
  
  // Campaign basic info
  name: text('name').notNull(),
  description: text('description'),
  status: campaignStatusEnum('status').notNull().default('draft'),
  priority: campaignPriorityEnum('priority').notNull().default('normal'),
  
  // Message content
  messageType: messageTypeEnum('message_type').notNull(),
  content: jsonb('content').notNull().$type<{
    text?: string;
    caption?: string;
    templateName?: string;
    templateParams?: Record<string, string>;
  }>(),
  mediaUrl: text('media_url'),
  mediaType: mediaTypeEnum('media_type'),
  
  // Recipients
  recipientType: recipientTypeEnum('recipient_type').notNull(),
  recipients: jsonb('recipients').notNull().$type<string[]>().default([]),
  groupIds: jsonb('group_ids').$type<string[]>(),
  csvData: jsonb('csv_data').$type<{
    fileName: string;
    totalContacts: number;
    uploadedAt: string;
  }>(),
  
  // Scheduling
  schedulingType: schedulingTypeEnum('scheduling_type').notNull().default('immediate'),
  scheduledFor: timestamp('scheduled_for'),
  timezone: text('timezone').notNull().default('Asia/Kolkata'),
  
  // Recurring options
  recurringFrequency: recurringFrequencyEnum('recurring_frequency'),
  recurringInterval: integer('recurring_interval'),
  recurringDaysOfWeek: jsonb('recurring_days_of_week').$type<number[]>(),
  recurringDayOfMonth: integer('recurring_day_of_month'),
  recurringEndDate: timestamp('recurring_end_date'),
  recurringMaxOccurrences: integer('recurring_max_occurrences'),
  
  // Smart scheduling
  smartSchedulingEnabled: boolean('smart_scheduling_enabled').default(false),
  optimizeForTimezone: boolean('optimize_for_timezone').default(false),
  avoidWeekends: boolean('avoid_weekends').default(false),
  preferredTime: text('preferred_time').default('10:00'),
  
  // Sending options
  batchSize: integer('batch_size').notNull().default(100),
  delayBetweenMessages: integer('delay_between_messages').notNull().default(5),
  respectBusinessHours: boolean('respect_business_hours').default(true),
  businessHoursStart: text('business_hours_start').default('09:00'),
  businessHoursEnd: text('business_hours_end').default('18:00'),
  
  // Execution tracking
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  pausedAt: timestamp('paused_at'),
  
  // Template info (for campaigns created from templates)
  templateId: text('template_id'),
  templateName: text('template_name'),
  
  // Metadata
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// Campaign statistics table for tracking performance
export const campaignStats = pgTable('campaign_stats', {
  id: text('id').primaryKey(),
  campaignId: text('campaign_id')
    .notNull()
    .references(() => campaigns.id, { onDelete: 'cascade' }),
  
  // Message stats
  totalRecipients: integer('total_recipients').notNull().default(0),
  messagesSent: integer('messages_sent').notNull().default(0),
  messagesDelivered: integer('messages_delivered').notNull().default(0),
  messagesFailed: integer('messages_failed').notNull().default(0),
  messagesRead: integer('messages_read').notNull().default(0),
  messagesReplied: integer('messages_replied').notNull().default(0),
  
  // Engagement metrics
  deliveryRate: integer('delivery_rate').default(0), // percentage * 100
  readRate: integer('read_rate').default(0), // percentage * 100
  replyRate: integer('reply_rate').default(0), // percentage * 100
  
  // Cost tracking
  costPerMessage: integer('cost_per_message').default(0), // in cents
  totalCost: integer('total_cost').default(0), // in cents
  
  // Timestamps
  lastUpdated: timestamp('last_updated').notNull().defaultNow(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// Campaign messages table for tracking individual message sends
export const campaignMessages = pgTable('campaign_messages', {
  id: text('id').primaryKey(),
  campaignId: text('campaign_id')
    .notNull()
    .references(() => campaigns.id, { onDelete: 'cascade' }),
  
  // Message info
  recipientNumber: text('recipient_number').notNull(),
  messageId: text('message_id'), // WhatsApp message ID
  status: text('status').notNull().default('pending'), // pending, sent, delivered, read, failed
  
  // Content
  messageContent: text('message_content').notNull(),
  mediaUrl: text('media_url'),
  
  // Tracking
  sentAt: timestamp('sent_at'),
  deliveredAt: timestamp('delivered_at'),
  readAt: timestamp('read_at'),
  failedAt: timestamp('failed_at'),
  errorMessage: text('error_message'),
  
  // Metadata
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// Campaign templates table for reusable templates
export const campaignTemplates = pgTable('campaign_templates', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organization.id, { onDelete: 'cascade' }),
  
  // Template info
  name: text('name').notNull(),
  description: text('description'),
  category: text('category').notNull(), // marketing, announcement, engagement, notification, seasonal
  
  // Message content (template)
  messageType: messageTypeEnum('message_type').notNull(),
  content: jsonb('content').notNull().$type<{
    text?: string;
    caption?: string;
    templateName?: string;
    templateParams?: Record<string, string>;
  }>(),
  mediaUrl: text('media_url'),
  mediaType: mediaTypeEnum('media_type'),
  
  // Usage tracking
  usageCount: integer('usage_count').notNull().default(0),
  estimatedEngagement: integer('estimated_engagement').default(75), // percentage
  isPopular: boolean('is_popular').default(false),
  
  // Settings
  isActive: boolean('is_active').default(true),
  isBuiltIn: boolean('is_built_in').default(false), // system templates
  
  // Metadata
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// Campaign recurring schedule tracking
export const campaignRecurrences = pgTable('campaign_recurrences', {
  id: text('id').primaryKey(),
  campaignId: text('campaign_id')
    .notNull()
    .references(() => campaigns.id, { onDelete: 'cascade' }),
  
  // Schedule info
  scheduledFor: timestamp('scheduled_for').notNull(),
  status: text('status').notNull().default('pending'), // pending, executing, completed, failed, skipped
  
  // Execution tracking
  executedAt: timestamp('executed_at'),
  completedAt: timestamp('completed_at'),
  
  // Results
  messagesSent: integer('messages_sent').default(0),
  messagesDelivered: integer('messages_delivered').default(0),
  messagesFailed: integer('messages_failed').default(0),
  
  // Metadata
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});