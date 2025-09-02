import { pgTable, text, timestamp, integer, jsonb, boolean } from 'drizzle-orm/pg-core';
import { organization } from './auth';
import { apikey } from './auth';
import { whatsappSession } from './whatsapp';

export const apiUsage = pgTable('api_usage', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organization.id, { onDelete: 'cascade' }),
  apiKeyId: text('api_key_id')
    .references(() => apikey.id, { onDelete: 'set null' }),
  whatsappSessionId: text('whatsapp_session_id')
    .references(() => whatsappSession.id, { onDelete: 'set null' }),
  
  // Request details
  endpoint: text('endpoint').notNull(), // /api/v1/messages/send, /api/v1/messages, etc.
  method: text('method').notNull(), // GET, POST, PUT, DELETE
  statusCode: integer('status_code').notNull(),
  
  // Timing
  responseTime: integer('response_time'), // in milliseconds
  timestamp: timestamp('timestamp').notNull().defaultNow(),
  
  // Request/Response data
  requestBody: jsonb('request_body'), // Store request payload for analysis
  responseBody: jsonb('response_body'), // Store response for debugging
  userAgent: text('user_agent'),
  ipAddress: text('ip_address'),
  
  // Message specific (for WhatsApp API)
  messageType: text('message_type'), // text, image, audio, video, document
  messageId: text('message_id'), // WhatsApp message ID
  recipientNumber: text('recipient_number'), // Phone number (for analytics)
  
  // Error tracking
  errorCode: text('error_code'), // Custom error codes
  errorMessage: text('error_message'),
  
  // Success indicators
  success: boolean('success').notNull().default(false),
  
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const apiUsageDailyStats = pgTable('api_usage_daily_stats', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organization.id, { onDelete: 'cascade' }),
  apiKeyId: text('api_key_id')
    .references(() => apikey.id, { onDelete: 'set null' }),
  
  // Date for aggregation
  date: timestamp('date').notNull(), // Date truncated to day
  
  // Aggregated metrics
  totalRequests: integer('total_requests').notNull().default(0),
  successfulRequests: integer('successful_requests').notNull().default(0),
  failedRequests: integer('failed_requests').notNull().default(0),
  
  // Response time metrics
  avgResponseTime: integer('avg_response_time'), // Average in milliseconds
  maxResponseTime: integer('max_response_time'),
  minResponseTime: integer('min_response_time'),
  
  // Message type breakdown
  textMessages: integer('text_messages').notNull().default(0),
  imageMessages: integer('image_messages').notNull().default(0),
  videoMessages: integer('video_messages').notNull().default(0),
  audioMessages: integer('audio_messages').notNull().default(0),
  documentMessages: integer('document_messages').notNull().default(0),
  
  // Status code breakdown
  status2xx: integer('status_2xx').notNull().default(0), // Success
  status4xx: integer('status_4xx').notNull().default(0), // Client errors
  status5xx: integer('status_5xx').notNull().default(0), // Server errors
  
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});