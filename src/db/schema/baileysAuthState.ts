import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const baileysAuthState = pgTable('baileys_auth_state', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().unique(),
  creds: text('creds').notNull(), // JSON string of AuthenticationCreds
  keys: text('keys').notNull(), // JSON string of keys object
  createdAt: timestamp('created_at').notNull(),
  updatedAt: timestamp('updated_at').notNull(),
});
