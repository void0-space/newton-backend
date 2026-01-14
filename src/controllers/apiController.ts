import { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { createId } from '@paralleldrive/cuid2';
import { db } from '../db/drizzle';
import { message } from '../db/schema';
import { auth } from '../lib/auth';

const sendMessageSchema = z
  .object({
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

export async function sendMessage(request: FastifyRequest, reply: FastifyReply) {
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

    request.log.info(`API: Sending message - To: ${to}, Type: ${type}`);

    // Get API key data (set by API key middleware)
    const apiKey = request.headers['x-api-key'];
    const verifiedKey = await auth.api.verifyApiKey({
      body: {
        key: apiKey as string,
      },
    });
    request.log.info(`API: Verified API key - ${JSON.stringify(verifiedKey.key?.metadata)}`);

    if (!verifiedKey.valid) {
      return reply.status(401).send({
        error: 'API key required',
        code: 'API_KEY_REQUIRED',
      });
    }

    // Get organization from API key
    const organizationId = verifiedKey.key?.metadata?.['organizationId'];

    if (!organizationId) {
      return reply.status(400).send({
        error:
          'Organization context required. Please ensure your API key is associated with an organization.',
        code: 'ORGANIZATION_REQUIRED',
      });
    }

    request.log.info(`API: Using organization: ${organizationId}`);

    // Get the WhatsApp account ID from API key metadata
    const whatsappAccountId = verifiedKey.key?.metadata?.['accountId'];

    // Use in-memory sessions instead of database query (cost optimization)
    let connectedSession;
    if (whatsappAccountId) {
      // Direct memory lookup - O(1) operation, no database query
      const sessionKey = `${organizationId}:${whatsappAccountId}`;
      const session = request.server.baileys.sessions.get(sessionKey);
      
      if (session && session.status === 'connected') {
        connectedSession = session;
      } else {
        return reply.status(404).send({
          error: `WhatsApp account ${whatsappAccountId} is not connected. Please ensure the account is connected and active.`,
          code: 'WHATSAPP_ACCOUNT_NOT_CONNECTED',
        });
      }
    } else {
      // Fallback: find first connected session from in-memory map
      const allSessions = Array.from(request.server.baileys.sessions.values());
      connectedSession = allSessions.find(
        s => s.organizationId === organizationId && s.status === 'connected'
      );

      if (!connectedSession) {
        return reply.status(404).send({
          error:
            'No connected WhatsApp session found. Please connect a WhatsApp account first or specify whatsappAccountId in API key.',
          code: 'SESSION_NOT_FOUND',
        });
      }
    }

    request.log.info(`API: Using WhatsApp session: ${connectedSession.id}`);

    let session = connectedSession;

    // If session is not connected, attempt to reconnect
    if (session.status !== 'connected') {
      request.log.info(
        `API: Session ${session.id} not connected (Status: ${session.status}). Attempting to reconnect...`
      );

      try {
        // Attempt to reconnect the session
        await request.server.baileys.reconnectSession(session.id, organizationId);

        // Wait for connection with polling - up to 5 seconds
        let isConnected = false;
        let attempts = 0;
        const maxAttempts = 10; // 10 attempts * 500ms = 5 seconds

        while (attempts < maxAttempts && !isConnected) {
          await new Promise(resolve => setTimeout(resolve, 500));

          // Check in-memory session first (cost optimization)
          const sessionKey = `${organizationId}:${session.id}`;
          const updatedSession = request.server.baileys.sessions.get(sessionKey);

          if (updatedSession?.status === 'connected') {
            isConnected = true;
            session = updatedSession;
            request.log.info(`API: Successfully reconnected session ${session.id} after ${(attempts + 1) * 500}ms`);
            break;
          } else if (updatedSession?.status === 'qr_required') {
            return reply.status(400).send({
              error:
                'WhatsApp session requires QR code scanning. Please scan the QR code in the admin panel to connect.',
              code: 'QR_SCAN_REQUIRED',
              sessionId: session.id,
              currentStatus: updatedSession.status,
              qrCode: updatedSession?.qrCode,
            });
          }

          attempts++;
        }

        if (!isConnected) {
          // Check final status from memory
          const sessionKey = `${organizationId}:${session.id}`;
          const finalSession = request.server.baileys.sessions.get(sessionKey);
          const currentStatus = finalSession?.status || 'unknown';

          request.log.error(
            `API: Failed to reconnect session ${session.id}. Status: ${currentStatus} after ${attempts * 500}ms`
          );

          return reply.status(503).send({
            error:
              'WhatsApp session could not be connected. Please check the session status and try again.',
            code: 'SESSION_CONNECTION_FAILED',
            sessionId: session.id,
            currentStatus: currentStatus,
          });
        }
      } catch (reconnectError) {
        request.log.error(reconnectError, `API: Error reconnecting session ${session.id}:`);
        return reply.status(503).send({
          error: 'Failed to reconnect WhatsApp session',
          code: 'RECONNECTION_FAILED',
          sessionId: session.id,
          details: reconnectError instanceof Error ? reconnectError.message : 'Unknown error',
        });
      }
    }

    // Refresh session to ensure socket is loaded
    if (!session.socket) {
      request.log.info(`API: Refreshing session ${session.id} to load socket...`);
      const refreshedSession = await request.server.baileys.getSession(session.id, organizationId);
      if (refreshedSession?.socket) {
        session = refreshedSession;
        request.log.info(`API: Session socket loaded successfully`);
      } else {
        request.log.error(
          `API: Session ${session.id} has no socket available`
        );
        return reply.status(503).send({
          error:
            'WhatsApp session socket is not initialized. Please reconnect the WhatsApp account from the dashboard.',
          code: 'SESSION_SOCKET_NOT_AVAILABLE',
          sessionId: session.id,
          currentStatus: session.status,
        });
      }
    }

    request.log.info('API: Session is connected, preparing to send message');

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
          fileName: fileName || 'document',
          caption: caption || undefined,
        };
        break;
      default:
        return reply.status(400).send({
          error: `Message type '${type}' is not supported`,
          code: 'UNSUPPORTED_MESSAGE_TYPE',
        });
    }

    // Add reply context if provided
    if (replyMessageId) {
      messageContent.quoted = { id: replyMessageId };
    }

    request.log.info('API: Sending message with content:' + ' (details logged)');

    // Send message via Baileys
    const result = await session.socket.sendMessage(to, messageContent);

    request.log.info('API: Message sent successfully:' + ' (details logged)');

    // Generate message ID for database
    const messageId = createId();

    // Save outgoing message to database
    await request.server.baileys.saveOutgoingMessage(
      organizationId,
      session.id,
      messageId,
      to,
      messageText || caption || 'media',
      result
    );

    // Usage tracking removed
    try {
      // Billing tracking removed
    } catch (usageError) {
      request.log.warn(
        'API: Failed to track usage: ' +
          (usageError instanceof Error ? usageError.message : String(usageError))
      );
    }

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
      'API: Error sending message: ' + (error instanceof Error ? error.message : String(error))
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
