import { pgTable, text, timestamp, boolean } from 'drizzle-orm/pg-core';
import { organization } from './auth';

export const webhook = pgTable('webhook', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organization.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  url: text('url').notNull(),
  events: text('events').array(), // events to listen for
  secret: text('secret'), // webhook secret for signature verification
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const webhookDelivery = pgTable('webhook_delivery', {
  id: text('id').primaryKey(),
  webhookId: text('webhook_id')
    .notNull()
    .references(() => webhook.id, { onDelete: 'cascade' }),
  event: text('event').notNull(),
  payload: text('payload').notNull(), // JSON string
  status: text('status').notNull().default('pending'), // pending, success, failed
  attempts: text('attempts').notNull().default('0'),
  lastAttemptAt: timestamp('last_attempt_at'),
  nextAttemptAt: timestamp('next_attempt_at'),
  responseStatus: text('response_status'),
  responseBody: text('response_body'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});