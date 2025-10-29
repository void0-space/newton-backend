import { pgTable, text, jsonb, timestamp } from 'drizzle-orm/pg-core';

export const baileysAuthState = pgTable('baileys_auth_state', {
  ns: text('ns').primaryKey(), // e.g., "baileys:sessionId"
  creds: jsonb('creds').notNull(), // Baileys credentials as JSONB
  keys: jsonb('keys').notNull(), // Signal keys as JSONB
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});
