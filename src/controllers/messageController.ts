import { FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../db/drizzle';
import { message, messageStatus, whatsappSession, media } from '../db/schema';
import { eq, and, desc, or, count } from 'drizzle-orm';
import { z } from 'zod';
import { createId } from '@paralleldrive/cuid2';

const sendMessageSchema = z.object({
  sessionId: z.string().min(1, 'Session ID is required'),
  to: z.string().min(1, 'Recipient phone number is required'),
  message: z.string().min(1, 'Message content is required'),
  type: z.enum(['text']).default('text'),
});

const sendMediaMessageSchema = z.object({
  sessionId: z.string().min(1, 'Session ID is required'),
  to: z.string().min(1, 'Recipient phone number is required'),
  mediaId: z.string().min(1, 'Media ID is required'),
  type: z.enum(['image', 'video', 'audio', 'document']).optional(),
  caption: z.string().optional(),
});

const sendMediaUrlSchema = z.object({
  sessionId: z.string().min(1, 'Session ID is required'),
  to: z.string().min(1, 'Recipient phone number is required'),
  mediaUrl: z.string().url('Valid media URL is required'),
  type: z.enum(['image', 'video', 'audio', 'document']),
  caption: z.string().optional(),
  filename: z.string().optional(),
});

const getMessagesSchema = z.object({
  sessionId: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
  offset: z.coerce.number().min(0).default(0),
  direction: z.enum(['inbound', 'outbound', 'all']).default('all'),
});

export async function sendTextMessage(request: FastifyRequest, reply: FastifyReply) {
  try {
    const { sessionId, to, message: messageText, type } = sendMessageSchema.parse(request.body);
    
    if (!request.organization) {
      return reply.status(400).send({
        error: 'Organization context required',
        code: 'ORGANIZATION_REQUIRED',
      });
    }

    // Get session and verify it belongs to organization
    const session = await request.server.baileys.getSession(sessionId, request.organization.id);
    
    if (!session) {
      return reply.status(404).send({
        error: 'WhatsApp session not found',
        code: 'SESSION_NOT_FOUND',
      });
    }

    if (!session.socket || session.status !== 'connected') {
      return reply.status(400).send({
        error: 'WhatsApp session is not connected',
        code: 'SESSION_NOT_CONNECTED',
      });
    }

    // Normalize phone number (add country code if missing)
    const normalizedTo = normalizePhoneNumber(to);
    
    // Send message via Baileys
    const result = await session.socket.sendMessage(normalizedTo, { text: messageText });
    
    if (!result) {
      return reply.status(500).send({
        error: 'Failed to send message',
        code: 'SEND_FAILED',
      });
    }

    // Save message to database
    const messageId = createId();
    const [savedMessage] = await db
      .insert(message)
      .values({
        id: messageId,
        organizationId: request.organization.id,
        sessionId,
        externalId: result.key?.id,
        direction: 'outbound',
        from: session.phoneNumber || sessionId,
        to: normalizedTo,
        messageType: type,
        content: { text: messageText },
        status: 'sent',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();


    // Track usage (legacy)
    if (request.trackUsage) {
      await request.trackUsage('messages_sent');
    }

    // Publish message event to Redis
    await request.server.redis.publish(
      `whatsapp:message:${sessionId}`,
      JSON.stringify({
        event: 'message.sent',
        data: {
          messageId: savedMessage.id,
          sessionId,
          to: normalizedTo,
          content: messageText,
          status: 'sent',
          timestamp: savedMessage.createdAt,
        },
      })
    );

    return reply.send({
      success: true,
      data: {
        messageId: savedMessage.id,
        externalId: result.key?.id,
        status: 'sent',
        timestamp: savedMessage.createdAt,
        to: normalizedTo,
        content: messageText,
        type,
      },
    });
  } catch (error) {
    request.log.error('Error sending text message: ' + (error instanceof Error ? error.message : String(error)));
    return reply.status(500).send({
      error: 'Failed to send message',
      code: 'SEND_MESSAGE_FAILED',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

export async function sendMediaMessage(request: FastifyRequest, reply: FastifyReply) {
  try {
    const { sessionId, to, mediaId, type, caption } = sendMediaMessageSchema.parse(request.body);
    
    if (!request.organization) {
      return reply.status(400).send({
        error: 'Organization context required',
        code: 'ORGANIZATION_REQUIRED',
      });
    }

    // Get media record from database
    const [mediaRecord] = await db
      .select()
      .from(media)
      .where(and(
        eq(media.id, mediaId),
        eq(media.organizationId, request.organization.id)
      ))
      .limit(1);

    if (!mediaRecord) {
      return reply.status(404).send({
        error: 'Media not found',
        code: 'MEDIA_NOT_FOUND',
      });
    }

    const session = await request.server.baileys.getSession(sessionId, request.organization.id);
    
    if (!session) {
      return reply.status(404).send({
        error: 'WhatsApp session not found',
        code: 'SESSION_NOT_FOUND',
      });
    }

    if (!session.socket || session.status !== 'connected') {
      return reply.status(400).send({
        error: 'WhatsApp session is not connected',
        code: 'SESSION_NOT_CONNECTED',
      });
    }

    const normalizedTo = normalizePhoneNumber(to);
    
    // Determine media type from MIME type if not provided
    const mediaType = type || request.server.storage.getMediaType(mediaRecord.mimeType);
    
    // Generate a fresh download URL for the media
    const mediaUrl = await request.server.storage.generateDownloadUrl(mediaRecord.filename, 3600);
    
    // Prepare media message based on type
    let mediaMessage: any;
    switch (mediaType) {
      case 'image':
        mediaMessage = {
          image: { url: mediaUrl },
          caption: caption,
        };
        break;
      case 'video':
        mediaMessage = {
          video: { url: mediaUrl },
          caption: caption,
        };
        break;
      case 'audio':
        mediaMessage = {
          audio: { url: mediaUrl },
          mimetype: mediaRecord.mimeType,
        };
        break;
      case 'document':
        mediaMessage = {
          document: { url: mediaUrl },
          mimetype: mediaRecord.mimeType,
          fileName: mediaRecord.originalName,
        };
        break;
      default:
        return reply.status(400).send({
          error: 'Unsupported media type',
          code: 'UNSUPPORTED_MEDIA_TYPE',
        });
    }

    const result = await session.socket.sendMessage(normalizedTo, mediaMessage);

    // Save message to database
    const messageId = createId();
    const [savedMessage] = await db
      .insert(message)
      .values({
        id: messageId,
        organizationId: request.organization.id,
        sessionId,
        externalId: result.key?.id,
        direction: 'outbound',
        from: session.phoneNumber || sessionId,
        to: normalizedTo,
        messageType: mediaType,
        content: { 
          mediaId,
          mediaUrl: mediaRecord.url,
          caption,
          filename: mediaRecord.originalName,
          type: mediaType,
        },
        mediaUrl: mediaRecord.url,
        status: 'sent',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();


    // Track usage (legacy)
    if (request.trackUsage) {
      await request.trackUsage('messages_sent');
      await request.trackUsage('media_sent');
    }

    return reply.send({
      success: true,
      data: {
        messageId: savedMessage.id,
        externalId: result.key?.id,
        status: 'sent',
        timestamp: savedMessage.createdAt,
        to: normalizedTo,
        type: mediaType,
        mediaId,
        mediaUrl: mediaRecord.url,
        caption,
        filename: mediaRecord.originalName,
      },
    });
  } catch (error) {
    request.log.error('Error sending media message: ' + (error instanceof Error ? error.message : String(error)));
    return reply.status(500).send({
      error: 'Failed to send media message',
      code: 'SEND_MEDIA_FAILED',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

export async function sendMediaFromUrl(request: FastifyRequest, reply: FastifyReply) {
  try {
    const { sessionId, to, mediaUrl, type, caption, filename } = sendMediaUrlSchema.parse(request.body);
    
    if (!request.organization) {
      return reply.status(400).send({
        error: 'Organization context required',
        code: 'ORGANIZATION_REQUIRED',
      });
    }

    const session = await request.server.baileys.getSession(sessionId, request.organization.id);
    
    if (!session) {
      return reply.status(404).send({
        error: 'WhatsApp session not found',
        code: 'SESSION_NOT_FOUND',
      });
    }

    if (!session.socket || session.status !== 'connected') {
      return reply.status(400).send({
        error: 'WhatsApp session is not connected',
        code: 'SESSION_NOT_CONNECTED',
      });
    }

    const normalizedTo = normalizePhoneNumber(to);
    
    // Prepare media message based on type
    let mediaMessage: any;
    switch (type) {
      case 'image':
        mediaMessage = {
          image: { url: mediaUrl },
          caption: caption,
        };
        break;
      case 'video':
        mediaMessage = {
          video: { url: mediaUrl },
          caption: caption,
        };
        break;
      case 'audio':
        mediaMessage = {
          audio: { url: mediaUrl },
          mimetype: 'audio/mpeg',
        };
        break;
      case 'document':
        mediaMessage = {
          document: { url: mediaUrl },
          mimetype: 'application/pdf',
          fileName: filename || 'document.pdf',
        };
        break;
    }

    const result = await session.socket.sendMessage(normalizedTo, mediaMessage);

    // Save message to database
    const messageId = createId();
    const [savedMessage] = await db
      .insert(message)
      .values({
        id: messageId,
        organizationId: request.organization.id,
        sessionId,
        externalId: result.key?.id,
        direction: 'outbound',
        from: session.phoneNumber || sessionId,
        to: normalizedTo,
        messageType: type,
        content: { 
          mediaUrl, 
          caption, 
          filename,
          type 
        },
        mediaUrl,
        status: 'sent',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    // Track usage
    if (request.trackUsage) {
      await request.trackUsage('messages_sent');
      await request.trackUsage('media_sent');
    }

    return reply.send({
      success: true,
      data: {
        messageId: savedMessage.id,
        externalId: result.key?.id,
        status: 'sent',
        timestamp: savedMessage.createdAt,
        to: normalizedTo,
        type,
        mediaUrl,
        caption,
      },
    });
  } catch (error) {
    request.log.error('Error sending media message from URL: ' + (error instanceof Error ? error.message : String(error)));
    return reply.status(500).send({
      error: 'Failed to send media message',
      code: 'SEND_MEDIA_FAILED',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

export async function getMessageStatus(request: FastifyRequest, reply: FastifyReply) {
  try {
    const { id } = request.params as { id: string };
    
    if (!request.organization) {
      return reply.status(400).send({
        error: 'Organization context required',
        code: 'ORGANIZATION_REQUIRED',
      });
    }

    const [messageRecord] = await db
      .select()
      .from(message)
      .where(and(
        eq(message.id, id),
        eq(message.organizationId, request.organization.id)
      ))
      .limit(1);

    if (!messageRecord) {
      return reply.status(404).send({
        error: 'Message not found',
        code: 'MESSAGE_NOT_FOUND',
      });
    }

    // Get message status history
    const statusHistory = await db
      .select()
      .from(messageStatus)
      .where(eq(messageStatus.messageId, id))
      .orderBy(desc(messageStatus.timestamp));

    return reply.send({
      success: true,
      data: {
        messageId: messageRecord.id,
        externalId: messageRecord.externalId,
        sessionId: messageRecord.sessionId,
        direction: messageRecord.direction,
        from: messageRecord.from,
        to: messageRecord.to,
        type: messageRecord.messageType,
        content: messageRecord.content,
        status: messageRecord.status,
        createdAt: messageRecord.createdAt,
        updatedAt: messageRecord.updatedAt,
        statusHistory: statusHistory.map(status => ({
          status: status.status,
          timestamp: status.timestamp,
          participant: status.participant,
        })),
      },
    });
  } catch (error) {
    request.log.error('Error fetching message status: ' + (error instanceof Error ? error.message : String(error)));
    return reply.status(500).send({
      error: 'Failed to fetch message status',
      code: 'FETCH_STATUS_FAILED',
    });
  }
}

export async function getMessages(request: FastifyRequest, reply: FastifyReply) {
  try {
    const { sessionId, limit, offset, direction } = getMessagesSchema.parse(request.query);
    
    if (!request.organization) {
      return reply.status(400).send({
        error: 'Organization context required',
        code: 'ORGANIZATION_REQUIRED',
      });
    }

    let whereClause = eq(message.organizationId, request.organization.id);
    
    if (sessionId) {
      whereClause = and(whereClause, eq(message.sessionId, sessionId));
    }
    
    if (direction !== 'all') {
      whereClause = and(whereClause, eq(message.direction, direction));
    }

    const messages = await db
      .select({
        id: message.id,
        externalId: message.externalId,
        sessionId: message.sessionId,
        direction: message.direction,
        from: message.from,
        to: message.to,
        messageType: message.messageType,
        content: message.content,
        status: message.status,
        mediaUrl: message.mediaUrl,
        createdAt: message.createdAt,
        updatedAt: message.updatedAt,
      })
      .from(message)
      .where(whereClause)
      .orderBy(desc(message.createdAt))
      .limit(limit)
      .offset(offset);

    const total = await db
      .select({ count: message.id })
      .from(message)
      .where(whereClause);

    return reply.send({
      success: true,
      data: {
        messages,
        pagination: {
          limit,
          offset,
          total: total.length,
          hasMore: total.length > offset + limit,
        },
      },
    });
  } catch (error) {
    request.log.error('Error fetching messages: ' + (error instanceof Error ? error.message : String(error)));
    return reply.status(500).send({
      error: 'Failed to fetch messages',
      code: 'FETCH_MESSAGES_FAILED',
    });
  }
}

export async function getMessagesBySession(request: FastifyRequest, reply: FastifyReply) {
  try {
    const { sessionId } = request.params as { sessionId: string };
    const { limit, offset } = getMessagesSchema.parse(request.query);
    
    if (!request.organization) {
      return reply.status(400).send({
        error: 'Organization context required',
        code: 'ORGANIZATION_REQUIRED',
      });
    }

    // Verify session belongs to organization
    const [sessionRecord] = await db
      .select()
      .from(whatsappSession)
      .where(and(
        eq(whatsappSession.id, sessionId),
        eq(whatsappSession.organizationId, request.organization.id)
      ))
      .limit(1);

    if (!sessionRecord) {
      return reply.status(404).send({
        error: 'Session not found',
        code: 'SESSION_NOT_FOUND',
      });
    }

    const messages = await db
      .select()
      .from(message)
      .where(and(
        eq(message.sessionId, sessionId),
        eq(message.organizationId, request.organization.id)
      ))
      .orderBy(desc(message.createdAt))
      .limit(limit)
      .offset(offset);

    return reply.send({
      success: true,
      data: {
        sessionId,
        messages: messages.map(msg => ({
          id: msg.id,
          externalId: msg.externalId,
          direction: msg.direction,
          from: msg.from,
          to: msg.to,
          type: msg.messageType,
          content: msg.content,
          status: msg.status,
          mediaUrl: msg.mediaUrl,
          createdAt: msg.createdAt,
        })),
        pagination: {
          limit,
          offset,
          hasMore: messages.length === limit,
        },
      },
    });
  } catch (error) {
    request.log.error('Error fetching session messages: ' + (error instanceof Error ? error.message : String(error)));
    return reply.status(500).send({
      error: 'Failed to fetch session messages',
      code: 'FETCH_SESSION_MESSAGES_FAILED',
    });
  }
}

export async function getMessagesByContact(request: FastifyRequest, reply: FastifyReply) {
  try {
    const { phone } = request.params as { phone: string };
    const { limit, offset } = getMessagesSchema.parse(request.query);

    if (!request.organization) {
      return reply.status(400).send({
        error: 'Organization context required',
        code: 'ORGANIZATION_REQUIRED',
      });
    }

    // Normalize phone number to match WhatsApp format
    const normalizedPhone = normalizePhoneNumber(phone);

    // Query messages where from or to matches the phone
    const messages = await db
      .select()
      .from(message)
      .where(and(
        eq(message.organizationId, request.organization.id),
        or(
          eq(message.from, normalizedPhone),
          eq(message.to, normalizedPhone)
        )
      ))
      .orderBy(desc(message.createdAt))
      .limit(limit)
      .offset(offset);

    // Get total count for pagination
    const countResult = await db
      .select({ count: count() })
      .from(message)
      .where(and(
        eq(message.organizationId, request.organization.id),
        or(
          eq(message.from, normalizedPhone),
          eq(message.to, normalizedPhone)
        )
      ));

    const total = countResult[0]?.count || 0;

    return reply.send({
      success: true,
      messages: messages.map(msg => ({
        id: msg.id,
        sessionId: msg.sessionId,
        accountPhone: msg.from === normalizedPhone ? msg.to : msg.from,
        direction: msg.direction,
        from: msg.from,
        to: msg.to,
        type: msg.messageType,
        message: typeof msg.content === 'string' ? msg.content : msg.content?.text,
        content: msg.content,
        status: msg.status,
        mediaUrl: msg.mediaUrl,
        timestamp: msg.createdAt?.toISOString(),
      })),
      pagination: {
        limit,
        offset,
        total,
        hasMore: offset + limit < total,
      },
    });
  } catch (error) {
    request.log.error('Error fetching contact messages: ' + (error instanceof Error ? error.message : String(error)));
    return reply.status(500).send({
      error: 'Failed to fetch contact messages',
      code: 'FETCH_CONTACT_MESSAGES_FAILED',
    });
  }
}

// Helper function to normalize phone numbers
function normalizePhoneNumber(phoneNumber: string): string {
  // Remove all non-numeric characters
  let normalized = phoneNumber.replace(/\D/g, '');
  
  // If number doesn't start with country code, assume it's Indian (+91)
  if (!normalized.startsWith('91') && normalized.length === 10) {
    normalized = '91' + normalized;
  }
  
  // Add WhatsApp suffix
  if (!normalized.includes('@s.whatsapp.net')) {
    normalized += '@s.whatsapp.net';
  }
  
  return normalized;
}