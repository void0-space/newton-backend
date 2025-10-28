import { pgTable, text, timestamp, boolean, integer, jsonb } from 'drizzle-orm/pg-core';
import { organization } from './auth';

export const whatsappSession = pgTable('whatsapp_session', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organization.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  phoneNumber: text('phone_number'),
  profileName: text('profile_name'), // WhatsApp profile display name
  profilePhoto: text('profile_photo'), // Profile photo URL
  status: text('status').notNull().default('disconnected'), // disconnected, connecting, connected, qr_required
  sessionBlob: text('session_blob'), // encrypted session data
  qrCode: text('qr_code'),
  pairingCode: text('pairing_code'), // Numeric code for pairing without QR
  lastActive: timestamp('last_active'),
  
  // Settings
  alwaysShowOnline: boolean('always_show_online').default(true),
  autoRejectCalls: boolean('auto_reject_calls').default(false),
  antiBanSubscribe: boolean('anti_ban_subscribe').default(false),
  antiBanStrictMode: boolean('anti_ban_strict_mode').default(false),
  webhookUrl: text('webhook_url'),
  webhookMethod: text('webhook_method').default('POST'),
  manuallyDisconnected: boolean('manually_disconnected').default(false), // Track manual disconnections
  
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const message = pgTable('message', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organization.id, { onDelete: 'cascade' }),
  sessionId: text('session_id')
    .notNull()
    .references(() => whatsappSession.id, { onDelete: 'cascade' }),
  externalId: text('external_id'), // WhatsApp message ID
  direction: text('direction').notNull(), // inbound, outbound
  from: text('from').notNull(),
  to: text('to').notNull(),
  messageType: text('message_type').notNull(), // text, image, audio, video, document
  content: jsonb('content').notNull(), // message content and metadata
  status: text('status').notNull().default('pending'), // pending, sent, delivered, read, failed
  mediaUrl: text('media_url'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const messageStatus = pgTable('message_status', {
  id: text('id').primaryKey(),
  messageId: text('message_id')
    .notNull()
    .references(() => message.id, { onDelete: 'cascade' }),
  status: text('status').notNull(), // sent, delivered, read
  timestamp: timestamp('timestamp').notNull(),
  participant: text('participant'), // for group messages
});

export const media = pgTable('media', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organization.id, { onDelete: 'cascade' }),
  messageId: text('message_id')
    .references(() => message.id, { onDelete: 'cascade' }),
  filename: text('filename').notNull(),
  originalName: text('original_name'),
  mimeType: text('mime_type').notNull(),
  size: integer('size').notNull(),
  url: text('url').notNull(), // R2 URL
  thumbnailUrl: text('thumbnail_url'),
  tusId: text('tus_id'), // TUS upload ID for resumable uploads
  uploadCompleted: boolean('upload_completed').default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});