import { pgTable, text, timestamp, jsonb } from 'drizzle-orm/pg-core';
import { organization } from './auth';

export const contact = pgTable('contact', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organization.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  phone: text('phone').notNull(),
  email: text('email'),
  groups: jsonb('groups').notNull().default('[]'), // array of group names
  tags: jsonb('tags').notNull().default('[]'), // array of tag names
  notes: text('notes'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const contactGroup = pgTable('contact_group', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organization.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  color: text('color'), // hex color for UI
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const contactTag = pgTable('contact_tag', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organization.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  color: text('color'), // hex color for UI
  createdAt: timestamp('created_at').notNull().defaultNow(),
});
