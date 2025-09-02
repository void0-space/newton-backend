import { pgTable, text, timestamp, jsonb, boolean } from 'drizzle-orm/pg-core';
import { organization } from './auth';
import { whatsappSession } from './whatsapp';

export const scheduledMessage = pgTable('scheduled_message', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organization.id, { onDelete: 'cascade' }),
  sessionId: text('session_id')
    .notNull()
    .references(() => whatsappSession.id, { onDelete: 'cascade' }),
  name: text('name').notNull(), // User-friendly name for the scheduled message
  recipients: jsonb('recipients').notNull(), // Array of phone numbers
  messageType: text('message_type').notNull().default('text'), // text, image, video, audio, document
  content: jsonb('content').notNull(), // Message content and metadata
  mediaUrl: text('media_url'), // URL for media messages
  scheduledFor: timestamp('scheduled_for').notNull(), // When to send
  status: text('status').notNull().default('pending'), // pending, sent, failed, cancelled
  isRecurring: boolean('is_recurring').notNull().default(false), // For future recurring messages
  recurringPattern: jsonb('recurring_pattern'), // Cron-like pattern for recurring messages
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  sentAt: timestamp('sent_at'), // Actual time when sent
  errorMessage: text('error_message'), // Error details if failed
});

export const scheduledMessageLog = pgTable('scheduled_message_log', {
  id: text('id').primaryKey(),
  scheduledMessageId: text('scheduled_message_id')
    .notNull()
    .references(() => scheduledMessage.id, { onDelete: 'cascade' }),
  recipient: text('recipient').notNull(), // Individual recipient phone number
  status: text('status').notNull(), // sent, failed, delivered, read
  messageId: text('message_id'), // WhatsApp message ID if sent successfully
  sentAt: timestamp('sent_at').notNull(),
  errorMessage: text('error_message'), // Error details if failed
  deliveredAt: timestamp('delivered_at'),
  readAt: timestamp('read_at'),
});