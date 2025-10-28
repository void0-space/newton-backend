import { FastifyRequest, FastifyReply } from 'fastify';
import { BaileysManager } from '../services/baileysService';
import { z } from 'zod';
import { createId } from '@paralleldrive/cuid2';
import { convertHeaders } from '../utils/header';
import { auth } from '../lib/auth';
import { db } from '../db/drizzle';
import { message, whatsappSession } from '../db/schema';
import { eq, and, ilike, or, count, desc } from 'drizzle-orm';

const createSessionSchema = z.object({
  name: z.string().min(1, 'Session name is required').optional(),
});

const sendMessageSchema = z
  .object({
    sessionId: z.string().min(1, 'Session ID is required'),
    to: z.string().min(1, 'Recipient phone number is required'),
    message: z.string().optional(), // Made optional for media messages
    type: z
      .enum(['text', 'image', 'video', 'audio', 'document', 'sticker', 'gif', 'button', 'template'])
      .default('text'),
    mediaUrl: z.string().optional(),
    fileName: z.string().optional(),
    caption: z.string().optional(),
    replyMessageId: z.string().optional(),
  })
  .refine(
    data => {
      // For text messages, message is required
      if (data.type === 'text' && !data.message) {
        return false;
      }
      return true;
    },
    {
      message: 'Message content is required for text messages',
      path: ['message'],
    }
  );

const updateSessionSettingsSchema = z.object({
  alwaysShowOnline: z.boolean().optional(),
  autoRejectCalls: z.boolean().optional(),
  antiBanSubscribe: z.boolean().optional(),
  antiBanStrictMode: z.boolean().optional(),
  webhookUrl: z.string().optional(),
  webhookMethod: z.enum(['POST', 'GET', 'PUT']).optional(),
});

declare module 'fastify' {
  interface FastifyInstance {
    baileys: BaileysManager;
  }
}

export async function createWhatsAppSession(request: FastifyRequest, reply: FastifyReply) {
  try {
    const body = createSessionSchema.parse(request.body || {});
    const headers = convertHeaders(request);

    const authSession = await auth.api.getSession({ headers });
    // Get organization from user session
    const organizationId = authSession?.session.activeOrganizationId;
    if (!organizationId) {
      return reply.status(400).send({
        error: 'Organization context required',
        code: 'ORGANIZATION_REQUIRED',
      });
    }

    const sessionId = createId();
    const session = await request.server.baileys.createSession(sessionId, organizationId);

    // Poll for QR code generation (up to 10 seconds)
    let updatedSession = null;
    let qrCodeReady = false;
    let attempts = 0;
    const maxAttempts = 20; // 10 seconds total (20 * 500ms)

    while (!qrCodeReady && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 500));
      updatedSession = await request.server.baileys.getSession(sessionId, organizationId);

      if (updatedSession?.qrCode) {
        qrCodeReady = true;
        request.log.info(`QR code ready after ${(attempts + 1) * 500}ms`);
      }
      attempts++;
    }

    if (!qrCodeReady) {
      request.log.warn(`QR code not ready after ${maxAttempts * 500}ms, returning anyway`);
    }

    return reply.status(201).send({
      qrCode: updatedSession?.qrCode || session.qrCode || '',
      sessionId: session.id,
      status: updatedSession?.status || session.status,
    });
  } catch (error) {
    request.log.error(
      'Error creating WhatsApp session: ' + (error instanceof Error ? error.message : String(error))
    );

    if (error instanceof Error && error.message.includes('already exists')) {
      return reply.status(409).send({
        error: 'Session already exists',
        code: 'SESSION_EXISTS',
      });
    }

    return reply.status(500).send({
      error: 'Failed to create WhatsApp session',
      code: 'CREATE_SESSION_FAILED',
    });
  }
}

export async function getWhatsAppSession(request: FastifyRequest, reply: FastifyReply) {
  try {
    const { id } = request.params as { id: string };

    const headers = convertHeaders(request);
    const authSession = await auth.api.getSession({ headers });

    const organizationId = authSession?.session.activeOrganizationId;
    if (!organizationId) {
      return reply.status(400).send({
        error: 'Organization context required',
        code: 'ORGANIZATION_REQUIRED',
      });
    }

    const session = await request.server.baileys.getSession(id, organizationId);

    if (!session) {
      return reply.status(404).send({
        error: 'Session not found',
        code: 'SESSION_NOT_FOUND',
      });
    }

    return reply.send({
      id: session.id,
      phoneNumber: session.phoneNumber,
      name: session.phoneNumber || 'WhatsApp Account',
      status: session.status === 'connected' ? 'connected' : 'disconnected',
      lastSeen: session.lastActive,
      createdAt: session.createdAt || new Date().toISOString(),
      pairingCode: session.pairingCode || null,
    });
  } catch (error) {
    request.log.error(
      'Error fetching WhatsApp session: ' + (error instanceof Error ? error.message : String(error))
    );
    return reply.status(500).send({
      error: 'Failed to fetch session',
      code: 'FETCH_SESSION_FAILED',
    });
  }
}

export async function listWhatsAppSessions(request: FastifyRequest, reply: FastifyReply) {
  try {
    const headers = convertHeaders(request);
    const authSession = await auth.api.getSession({ headers });

    const organizationId = authSession?.session.activeOrganizationId;
    if (!organizationId) {
      return reply.status(400).send({
        error: 'Organization context required',
        code: 'ORGANIZATION_REQUIRED',
      });
    }

    const sessions = await request.server.baileys.listSessions(organizationId);

    return reply.send({
      accounts: sessions.map(session => ({
        id: session.id,
        phoneNumber: session.phoneNumber,
        name: session.phoneNumber || 'WhatsApp Account',
        status: session.status, // Return the actual status from the session
        lastSeen: session.lastActive,
        createdAt: session.createdAt || new Date().toISOString(),
        pairingCode: session.pairingCode || null,
      })),
    });
  } catch (error) {
    request.log.error(
      'Error listing WhatsApp sessions: ' + (error instanceof Error ? error.message : String(error))
    );
    return reply.status(500).send({
      error: 'Failed to list sessions',
      code: 'LIST_SESSIONS_FAILED',
    });
  }
}

export async function disconnectWhatsAppSession(request: FastifyRequest, reply: FastifyReply) {
  try {
    const { id } = request.params as { id: string };

    const headers = convertHeaders(request);
    const authSession = await auth.api.getSession({ headers });

    const organizationId = authSession?.session.activeOrganizationId;
    if (!organizationId) {
      return reply.status(400).send({
        error: 'Organization context required',
        code: 'ORGANIZATION_REQUIRED',
      });
    }

    request.log.info(`Disconnecting session ${id} for organization ${organizationId}`);

    await request.server.baileys.disconnectSession(id, organizationId);

    request.log.info(`Successfully disconnected session ${id}`);

    return reply.send({
      success: true,
      message: 'Account disconnected successfully',
    });
  } catch (error) {
    request.log.error(
      'Error disconnecting WhatsApp session: ' +
        (error instanceof Error ? error.message : String(error))
    );
    return reply.status(500).send({
      error: 'Failed to disconnect account',
      code: 'DISCONNECT_SESSION_FAILED',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

// Internal sendMessage for admin panel (requires sessionId)
export async function sendMessageInternal(request: FastifyRequest, reply: FastifyReply) {
  try {
    const {
      to: rawPhoneNumber,
      message: messageText,
      type,
      mediaUrl,
      fileName,
      caption,
      replyMessageId,
    } = sendMessageSchema.parse(request.body);

    // Format phone number - add @s.whatsapp.net if not already present
    const to = rawPhoneNumber.includes('@') ? rawPhoneNumber : `${rawPhoneNumber}@s.whatsapp.net`;

    request.log.info(`Sending message - To: ${to}, Type: ${type}`);

    // Get organization from API key (set by API key middleware)
    const organizationId =
      (request as any).apiKey?.organizationId || (request as any).organization?.id;

    if (!organizationId) {
      request.log.error('No organization found for API key');
      return reply.status(400).send({
        error:
          'Organization context required. Please ensure your API key is associated with an organization.',
        code: 'ORGANIZATION_REQUIRED',
      });
    }

    request.log.info(`Using organization: ${organizationId}`);

    // Get the WhatsApp account ID from API key metadata
    const whatsappAccountId = (request as any).apiKey?.whatsappAccountId;

    // Find sessions for this organization
    const sessions = await request.server.baileys.listSessions(organizationId);

    let connectedSession;
    if (whatsappAccountId) {
      // Use the specific WhatsApp account from API key metadata
      connectedSession = sessions.find(
        session => session.id === whatsappAccountId && session.status === 'connected'
      );

      if (!connectedSession) {
        return reply.status(404).send({
          error: `WhatsApp account ${whatsappAccountId} is not connected. Please ensure the account is connected and active.`,
          code: 'WHATSAPP_ACCOUNT_NOT_CONNECTED',
        });
      }
    } else {
      // Fallback: use the first connected session
      connectedSession = sessions.find(session => session.status === 'connected');

      if (!connectedSession) {
        return reply.status(404).send({
          error:
            'No connected WhatsApp session found. Please connect a WhatsApp account first or specify whatsappAccountId in API key.',
          code: 'SESSION_NOT_FOUND',
        });
      }
    }

    request.log.info(`Using WhatsApp session: ${connectedSession.id}`);

    const session = connectedSession; // Use the connected session we found

    if (!session.socket || session.status !== 'connected') {
      request.log.error(
        `Session ${session.id} not connected. Status: ${session.status}, Socket exists: ${!!session.socket}`
      );
      return reply.status(400).send({
        error: 'Session is not connected',
        code: 'SESSION_NOT_CONNECTED',
      });
    }

    request.log.info('Session is connected, preparing to send message');

    // Prepare message content based on type
    let messageContent: any = {};

    switch (type) {
      case 'text':
        if (!messageText) {
          return reply.status(400).send({
            error: 'Message content is required for text messages',
            code: 'MESSAGE_REQUIRED',
          });
        }
        messageContent = { text: messageText };
        break;
      case 'image':
        if (!mediaUrl) {
          return reply.status(400).send({
            error: 'Media URL is required for image messages',
            code: 'MEDIA_URL_REQUIRED',
          });
        }
        messageContent = {
          image: { url: mediaUrl },
          caption: caption || undefined,
        };
        break;
      case 'video':
        if (!mediaUrl) {
          return reply.status(400).send({
            error: 'Media URL is required for video messages',
            code: 'MEDIA_URL_REQUIRED',
          });
        }
        messageContent = {
          video: { url: mediaUrl },
          caption: caption || undefined,
        };
        break;
      case 'audio':
        if (!mediaUrl) {
          return reply.status(400).send({
            error: 'Media URL is required for audio messages',
            code: 'MEDIA_URL_REQUIRED',
          });
        }
        messageContent = {
          audio: { url: mediaUrl },
          mimetype: 'audio/ogg; codecs=opus',
        };
        break;
      case 'document':
        if (!mediaUrl) {
          return reply.status(400).send({
            error: 'Media URL is required for document messages',
            code: 'MEDIA_URL_REQUIRED',
          });
        }
        messageContent = {
          document: { url: mediaUrl },
          fileName: fileName || 'document.pdf',
          caption: caption || undefined,
        };
        break;
      case 'sticker':
        if (!mediaUrl) {
          return reply.status(400).send({
            error: 'Media URL is required for sticker messages',
            code: 'MEDIA_URL_REQUIRED',
          });
        }
        messageContent = { sticker: { url: mediaUrl } };
        break;
      case 'gif':
        if (!mediaUrl) {
          return reply.status(400).send({
            error: 'Media URL is required for GIF messages',
            code: 'MEDIA_URL_REQUIRED',
          });
        }
        messageContent = {
          video: { url: mediaUrl },
          gifPlayback: true,
          caption: caption || undefined,
        };
        break;
      default:
        // For button and template types, fall back to text for now
        messageContent = { text: messageText };
    }

    // Add reply context if provided
    if (replyMessageId) {
      messageContent.quoted = { id: replyMessageId };
    }

    // Format the phone number as WhatsApp JID
    const formattedTo = to.includes('@') ? to : `${to}@s.whatsapp.net`;

    request.log.info('Sending message with content:' + ' (details logged)');

    // Send message via Baileys
    const result = await session.socket.sendMessage(formattedTo, messageContent);

    request.log.info('Message sent successfully:' + ' (details logged)');

    // Save message to database
    const messageId = createId();
    const contentForDb = messageText || caption || `${type} message`;
    await request.server.baileys.saveOutgoingMessage(
      organizationId,
      session.id,
      messageId,
      to,
      contentForDb,
      result
    );

    return reply.send({
      success: true,
      data: {
        messageId: result?.key?.id || messageId,
        status: 'sent',
        timestamp: new Date().toISOString(),
        to,
        content: contentForDb,
        type,
        mediaUrl: mediaUrl || undefined,
        caption: caption || undefined,
      },
    });
  } catch (error) {
    request.log.error(
      `Error sending message: ${JSON.stringify({
        error: error instanceof Error ? error.message : error,
        stack: error instanceof Error ? error.stack : undefined,
      })}`
    );
    return reply.status(500).send({
      error: 'Failed to send message',
      code: 'SEND_MESSAGE_FAILED',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

export async function deleteWhatsAppSession(request: FastifyRequest, reply: FastifyReply) {
  try {
    const { id } = request.params as { id: string };

    request.log.info(`Delete session request for ID: ${id}`);

    const headers = convertHeaders(request);
    const authSession = await auth.api.getSession({ headers });

    request.log.info('Auth session:' + ' (details logged)');

    const organizationId = authSession?.session.activeOrganizationId;
    if (!organizationId) {
      request.log.warn('No organization ID found in session');
      return reply.status(400).send({
        error: 'Organization context required',
        code: 'ORGANIZATION_REQUIRED',
      });
    }

    request.log.info(`Deleting session ${id} for organization ${organizationId}`);

    // First disconnect the session if it's connected
    await request.server.baileys.disconnectSession(id, organizationId);

    // Then delete it from database
    await request.server.baileys.deleteSession(id, organizationId);

    request.log.info(`Successfully deleted session ${id}`);

    return reply.send({
      success: true,
      message: 'Account deleted successfully',
    });
  } catch (error) {
    request.log.error(
      {
        error: error instanceof Error ? error.message : error,
        stack: error instanceof Error ? error.stack : undefined,
        sessionId: (request.params as any)?.id,
      },
      'Error deleting WhatsApp session:'
    );
    return reply.status(500).send({
      error: 'Failed to delete account',
      code: 'DELETE_SESSION_FAILED',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

export async function getSessionQR(request: FastifyRequest, reply: FastifyReply) {
  try {
    const { sessionId } = request.params as { sessionId: string };

    const headers = convertHeaders(request);
    const authSession = await auth.api.getSession({ headers });

    const organizationId = authSession?.session.activeOrganizationId;
    if (!organizationId) {
      return reply.status(400).send({
        error: 'Organization context required',
        code: 'ORGANIZATION_REQUIRED',
      });
    }

    const session = await request.server.baileys.getSession(sessionId, organizationId);

    if (!session) {
      return reply.status(404).send({
        error: 'Session not found',
        code: 'SESSION_NOT_FOUND',
      });
    }

    return reply.send({
      status: session.status,
      message:
        session.status === 'connected'
          ? 'Connected successfully'
          : session.status === 'connecting'
            ? 'Still connecting...'
            : 'Connection failed',
    });
  } catch (error) {
    request.log.error(
      'Error fetching connection status: ' +
        (error instanceof Error ? error.message : String(error))
    );
    return reply.status(500).send({
      error: 'Failed to fetch connection status',
      code: 'FETCH_STATUS_FAILED',
    });
  }
}

export async function getMessages(request: FastifyRequest, reply: FastifyReply) {
  try {
    const headers = convertHeaders(request);
    const authSession = await auth.api.getSession({ headers });

    const organizationId = authSession?.session.activeOrganizationId;
    if (!organizationId) {
      return reply.status(400).send({
        error: 'Organization context required',
        code: 'ORGANIZATION_REQUIRED',
      });
    }

    // Get query parameters for filtering and pagination
    const query = request.query as {
      page?: string;
      limit?: string;
      sessionId?: string;
      type?: string;
      status?: string;
      search?: string;
    };

    const page = parseInt(query.page || '1', 10);
    const limit = parseInt(query.limit || '20', 10);
    const offset = (page - 1) * limit;

    request.log.info(`Fetching messages for organization: ${organizationId}`);

    // Build query filters
    let whereConditions = [eq(message.organizationId, organizationId)];

    // Add sessionId filter
    if (query.sessionId) {
      whereConditions.push(eq(message.sessionId, query.sessionId));
    }

    // Add message type filter
    if (query.type) {
      whereConditions.push(eq(message.messageType, query.type));
    }

    // Add status filter
    if (query.status) {
      whereConditions.push(eq(message.status, query.status));
    }

    // Add search filter
    if (query.search) {
      whereConditions.push(ilike(message.content, `%${query.search}%`));
    }

    // Fetch messages from database
    const messages = await db
      .select({
        id: message.id,
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
      .where(and(...whereConditions))
      .orderBy(desc(message.createdAt))
      .limit(limit)
      .offset(offset);

    // Get total count for pagination
    const [{ total }] = await db
      .select({ total: count() })
      .from(message)
      .where(and(...whereConditions));

    // Get sessions for account information
    const sessions = await db
      .select()
      .from(whatsappSession)
      .where(eq(whatsappSession.organizationId, organizationId));

    const sessionMap = new Map(sessions.map(s => [s.id, s]));

    // Format messages with account information
    const formattedMessages = messages.map((msg: any) => {
      const session = sessionMap.get(msg.sessionId);
      return {
        id: msg.id,
        sessionId: msg.sessionId,
        accountName: session?.phoneNumber || session?.name || 'WhatsApp Account',
        accountPhone: session?.phoneNumber || 'Unknown',
        direction: msg.direction,
        from: msg.from,
        to: msg.to,
        content: (() => {
          try {
            if (typeof msg.content === 'string') {
              const parsed = JSON.parse(msg.content);
              return parsed.text || parsed.caption || msg.content;
            }
            return typeof msg.content === 'object'
              ? msg.content.text || msg.content.caption || JSON.stringify(msg.content)
              : msg.content;
          } catch {
            return msg.content;
          }
        })(),
        type: msg.messageType || 'text',
        status: msg.status || 'sent',
        timestamp: msg.createdAt,
        mediaUrl: msg.mediaUrl,
      };
    });

    return reply.send({
      success: true,
      messages: formattedMessages,
      pagination: {
        page,
        limit,
        total,
        hasMore: formattedMessages.length === limit,
      },
    });
  } catch (error) {
    request.log.error(
      {
        error: error instanceof Error ? error.message : error,
        stack: error instanceof Error ? error.stack : undefined,
      } instanceof Error
        ? {
            error: error instanceof Error ? error.message : error,
            stack: error instanceof Error ? error.stack : undefined,
          }.error
        : String({
            error: error instanceof Error ? error.message : error,
            stack: error instanceof Error ? error.stack : undefined,
          }),
      'Error fetching messages:'
    );
    return reply.status(500).send({
      error: 'Failed to fetch messages',
      code: 'FETCH_MESSAGES_FAILED',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

export async function updateSessionSettings(request: FastifyRequest, reply: FastifyReply) {
  try {
    const { id } = request.params as { id: string };
    const body = updateSessionSettingsSchema.parse(request.body);

    const headers = convertHeaders(request);
    const authSession = await auth.api.getSession({ headers });

    const organizationId = authSession?.session.activeOrganizationId;
    if (!organizationId) {
      return reply.status(400).send({
        error: 'Organization context required',
        code: 'ORGANIZATION_REQUIRED',
      });
    }

    request.log.info(`Updating settings for session ${id}: ${JSON.stringify(body)}`);

    await request.server.baileys.updateSessionSettings(id, organizationId, body);

    return reply.send({
      success: true,
      message: 'Settings updated successfully',
    });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      error: 'Failed to update settings',
      code: 'UPDATE_SETTINGS_FAILED',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

export async function reconnectWhatsAppSession(request: FastifyRequest, reply: FastifyReply) {
  try {
    const { id } = request.params as { id: string };

    const headers = convertHeaders(request);
    const authSession = await auth.api.getSession({ headers });

    const organizationId = authSession?.session.activeOrganizationId;
    if (!organizationId) {
      return reply.status(400).send({
        error: 'Organization context required',
        code: 'ORGANIZATION_REQUIRED',
      });
    }

    request.log.info(`Reconnecting session ${id} for organization ${organizationId}`);

    await request.server.baileys.reconnectSession(id, organizationId);

    return reply.send({
      success: true,
      message: 'Reconnection initiated successfully',
    });
  } catch (error) {
    request.log.error(
      {
        error: error instanceof Error ? error.message : error,
        stack: error instanceof Error ? error.stack : undefined,
        sessionId: (request.params as any)?.id,
      },
      'Error reconnecting WhatsApp session:'
    );

    return reply.status(500).send({
      error: 'Failed to reconnect session',
      code: 'RECONNECT_SESSION_FAILED',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

// Fixed internal sendMessage that requires sessionId and uses session auth
export async function internalSendMessage(request: FastifyRequest, reply: FastifyReply) {
  try {
    const {
      sessionId,
      to: rawPhoneNumber,
      message: messageText,
      type = 'text',
      mediaUrl,
      fileName,
      caption,
      replyMessageId,
    } = sendMessageSchema.parse(request.body);

    const to = rawPhoneNumber.includes('@') ? rawPhoneNumber : `${rawPhoneNumber}@s.whatsapp.net`;

    request.log.info(
      `Internal: Sending message - SessionId: ${sessionId}, To: ${to}, Type: ${type}`
    );

    const headers = convertHeaders(request);
    const userSession = await auth.api.getSession({ headers });
    const organizations = await auth.api.listOrganizations({ headers });

    const organization = organizations.find(
      org => org.id === userSession?.session?.activeOrganizationId
    );

    if (!organization) {
      return reply.status(400).send({
        error: 'Organization not selected, please select an organization',
        code: 'ORGANIZATION_REQUIRED',
      });
    }

    const session = await request.server.baileys.getSession(sessionId, organization.id);

    if (!session) {
      return reply.status(404).send({
        error: 'Session not found',
        code: 'SESSION_NOT_FOUND',
      });
    }

    if (!session.socket || session.status !== 'connected') {
      return reply.status(400).send({
        error: 'Session is not connected',
        code: 'SESSION_NOT_CONNECTED',
      });
    }

    let messageContent: any = {};

    switch (type) {
      case 'text':
        if (!messageText) {
          return reply.status(400).send({
            error: 'Message content is required for text messages',
            code: 'MESSAGE_REQUIRED',
          });
        }
        messageContent = { text: messageText };
        break;
      case 'image':
        if (!mediaUrl) {
          return reply.status(400).send({
            error: 'Media URL is required for image messages',
            code: 'MEDIA_URL_REQUIRED',
          });
        }
        messageContent = {
          image: { url: mediaUrl },
          caption: caption || undefined,
        };
        break;
      default:
        return reply.status(400).send({
          error: `Message type '${type}' is not supported`,
          code: 'UNSUPPORTED_MESSAGE_TYPE',
        });
    }

    if (replyMessageId) {
      messageContent.quoted = { id: replyMessageId };
    }

    const result = await session.socket.sendMessage(to, messageContent);

    const messageId = createId();
    await request.server.baileys.saveOutgoingMessage(
      organization.id,
      session.id,
      messageId,
      to,
      messageText || caption || 'media',
      result
    );

    return reply.send({
      success: true,
      messageId: result?.key?.id,
      status: result?.status || 'sent',
      to,
      sessionId: session.id,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    request.log.error(
      'Internal: Error sending message: ' + (error instanceof Error ? error.message : String(error))
    );

    if (error instanceof z.ZodError) {
      return reply.status(400).send({
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: error.errors,
      });
    }

    return reply.status(500).send({
      error: 'Failed to send message',
      code: 'SEND_MESSAGE_FAILED',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
