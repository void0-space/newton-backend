import { pgTable, text, boolean, timestamp, integer, jsonb, uuid, index } from 'drizzle-orm/pg-core';
import { createId } from '@paralleldrive/cuid2';
import { organization } from './auth';
import { whatsappSession } from './whatsapp';

export const autoReply = pgTable('auto_reply', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  whatsappAccountId: text('whatsapp_account_id').notNull().references(() => whatsappSession.id, { onDelete: 'cascade' }),
  
  // Rule configuration
  name: text('name').notNull(), // Rule name for identification
  isEnabled: boolean('is_enabled').notNull().default(true),
  priority: integer('priority').notNull().default(1), // Higher number = higher priority
  
  // Trigger conditions
  triggerType: text('trigger_type', { enum: ['keyword', 'contains', 'exact_match', 'regex', 'all_messages', 'business_hours', 'after_hours'] }).notNull().default('keyword'),
  keywords: jsonb('keywords').$type<string[]>(), // Array of keywords for keyword matching
  pattern: text('pattern'), // Regex pattern or exact text
  caseSensitive: boolean('case_sensitive').notNull().default(false),
  
  // Response configuration
  responseType: text('response_type', { enum: ['text', 'media', 'template', 'forward'] }).notNull().default('text'),
  responseText: text('response_text'), // Auto reply message
  mediaUrl: text('media_url'), // Media file URL
  mediaType: text('media_type', { enum: ['image', 'video', 'audio', 'document'] }), // Type of media
  templateName: text('template_name'), // WhatsApp template name
  templateParams: jsonb('template_params').$type<Record<string, string>>(), // Template parameters
  forwardToNumber: text('forward_to_number'), // Phone number to forward to
  
  // Timing and limits
  businessHoursStart: text('business_hours_start'), // Format: "09:00"
  businessHoursEnd: text('business_hours_end'), // Format: "17:00"
  businessDays: jsonb('business_days').$type<number[]>(), // Array of weekdays (0=Sunday, 6=Saturday)
  timezone: text('timezone').default('UTC'),
  delaySeconds: integer('delay_seconds').default(0), // Delay before sending reply
  
  // Rate limiting
  maxRepliesPerContact: integer('max_replies_per_contact').default(1), // Max replies per contact per day
  maxRepliesPerHour: integer('max_replies_per_hour'), // Global rate limit
  resetInterval: integer('reset_interval').default(24), // Hours to reset rate limit
  
  // Analytics
  totalTriggers: integer('total_triggers').notNull().default(0),
  totalReplies: integer('total_replies').notNull().default(0),
  lastTriggered: timestamp('last_triggered'),
  
  // Metadata
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  createdBy: text('created_by').notNull(), // User ID who created the rule
}, (table) => ({
  orgAccountIdx: index('auto_reply_org_account_idx').on(table.organizationId, table.whatsappAccountId),
  priorityIdx: index('auto_reply_priority_idx').on(table.priority),
  enabledIdx: index('auto_reply_enabled_idx').on(table.isEnabled),
}));

// Track auto reply usage per contact to enforce rate limits
export const autoReplyUsage = pgTable('auto_reply_usage', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  autoReplyId: text('auto_reply_id').notNull().references(() => autoReply.id, { onDelete: 'cascade' }),
  contactPhone: text('contact_phone').notNull(),
  triggerCount: integer('trigger_count').notNull().default(0),
  replyCount: integer('reply_count').notNull().default(0),
  lastTriggered: timestamp('last_triggered').notNull().defaultNow(),
  lastReplied: timestamp('last_replied'),
  resetAt: timestamp('reset_at').notNull(), // When the counter resets
  
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  ruleContactIdx: index('auto_reply_usage_rule_contact_idx').on(table.autoReplyId, table.contactPhone),
  resetIdx: index('auto_reply_usage_reset_idx').on(table.resetAt),
}));

// Log all auto reply activities for analytics and debugging
export const autoReplyLog = pgTable('auto_reply_log', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  autoReplyId: text('auto_reply_id').notNull().references(() => autoReply.id, { onDelete: 'cascade' }),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  whatsappAccountId: text('whatsapp_account_id').notNull().references(() => whatsappSession.id, { onDelete: 'cascade' }),
  
  // Message details
  contactPhone: text('contact_phone').notNull(),
  contactName: text('contact_name'),
  incomingMessageId: text('incoming_message_id'), // WhatsApp message ID that triggered
  incomingMessage: text('incoming_message'), // Original message content
  
  // Trigger details
  triggerMatched: text('trigger_matched'), // What keyword/pattern matched
  triggerType: text('trigger_type').notNull(),
  
  // Response details
  responseType: text('response_type').notNull(),
  responseText: text('response_text'),
  outgoingMessageId: text('outgoing_message_id'), // WhatsApp message ID of reply
  responseStatus: text('response_status', { enum: ['sent', 'failed', 'skipped'] }).notNull(),
  errorMessage: text('error_message'),
  
  // Metadata
  processedAt: timestamp('processed_at').notNull().defaultNow(),
  responseTime: integer('response_time'), // Processing time in milliseconds
}, (table) => ({
  orgIdx: index('auto_reply_log_org_idx').on(table.organizationId),
  accountIdx: index('auto_reply_log_account_idx').on(table.whatsappAccountId),
  contactIdx: index('auto_reply_log_contact_idx').on(table.contactPhone),
  dateIdx: index('auto_reply_log_date_idx').on(table.processedAt),
}));

export type AutoReply = typeof autoReply.$inferSelect;
export type NewAutoReply = typeof autoReply.$inferInsert;
export type AutoReplyUsage = typeof autoReplyUsage.$inferSelect;
export type NewAutoReplyUsage = typeof autoReplyUsage.$inferInsert;
export type AutoReplyLog = typeof autoReplyLog.$inferSelect;
export type NewAutoReplyLog = typeof autoReplyLog.$inferInsert;