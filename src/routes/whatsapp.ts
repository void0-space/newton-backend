import { FastifyPluginAsync, FastifyRequest } from 'fastify';
import {
  createWhatsAppSession,
  getWhatsAppSession,
  listWhatsAppSessions,
  disconnectWhatsAppSession,
  deleteWhatsAppSession,
  internalSendMessage,
  getSessionQR,
  getMessages,
  updateSessionSettings,
  reconnectWhatsAppSession,
} from '../controllers/whatsappController';
import { getMessagesByContact } from '../controllers/messageController';
import { sendMessage } from '../controllers/apiController';
import { auth } from '../lib/auth';
import { convertHeaders } from '../utils/header';
// Removed complex paywall middleware - using client-side checks instead
import { whatsappSession } from '../db/schema/whatsapp';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/drizzle';

const whatsappRoutes: FastifyPluginAsync = async fastify => {
  // Session-based authentication middleware for account management routes
  const sessionAuthMiddleware = async (request: FastifyRequest, reply: any) => {
    try {
      // Convert Fastify headers to standard Headers object
      const headers = convertHeaders(request);

      request.log.info('Session auth middleware - checking session');
      const session = await auth.api.getSession({ headers });

      request.log.info(
        `Session data: ${JSON.stringify({
          hasSession: !!session?.session,
          hasActiveOrg: !!session?.session?.activeOrganizationId,
          activeOrganizationId: session?.session?.activeOrganizationId,
        })}`
      );

      if (!session?.session) {
        request.log.warn('No session found in auth middleware');
        return reply.status(401).send({
          error: 'Authentication required',
          code: 'AUTH_REQUIRED',
        });
      }

      if (!session?.session.activeOrganizationId) {
        request.log.warn('No active organization found in session');
        return reply.status(400).send({
          error: 'User must be associated with an organization',
          code: 'NO_ORGANIZATION',
        });
      }

      // Set organization context for the request
      (request as any).organization = {
        id: session.session.activeOrganizationId,
        name: 'Unknown', // TODO: Get organization name from database using activeOrganizationId
      };

      request.log.info(
        `Session authenticated for organization: ${session.session.activeOrganizationId}`
      );
    } catch (error) {
      request.log.error(
        'Error in session auth middleware: ' +
          (error instanceof Error ? error.message : String(error))
      );
      return reply.status(500).send({
        error: 'Authentication error',
        code: 'AUTH_ERROR',
      });
    }
  };

  // API key authentication middleware for sending routes
  const apiKeyAuthMiddleware = async (request: FastifyRequest, _reply: any) => {
    const _apiKey = request.headers['x-api-key'];
    // Check for API key
    // if (!apiKey) {
    //   return reply.status(401).send({
    //     error: 'API key required',
    //     code: 'API_KEY_REQUIRED',
    //   });
    // }
  };

  // Session management routes - require user session
  fastify.post('/connect', { preHandler: sessionAuthMiddleware }, createWhatsAppSession);
  fastify.get('/accounts', { preHandler: sessionAuthMiddleware }, listWhatsAppSessions);
  fastify.get('/accounts/:id', { preHandler: sessionAuthMiddleware }, getWhatsAppSession);
  fastify.post(
    '/accounts/:id/disconnect',
    { preHandler: sessionAuthMiddleware },
    disconnectWhatsAppSession
  );
  fastify.post(
    '/accounts/:id/reconnect',
    { preHandler: sessionAuthMiddleware },
    reconnectWhatsAppSession
  );
  fastify.delete('/accounts/:id', { preHandler: sessionAuthMiddleware }, deleteWhatsAppSession);
  fastify.put(
    '/accounts/:id/settings',
    { preHandler: sessionAuthMiddleware },
    updateSessionSettings
  );
  fastify.get('/connection-status/:sessionId', { preHandler: sessionAuthMiddleware }, getSessionQR);

  // Pairing code generation route
  fastify.post(
    '/accounts/:id/generate-pairing-code',
    { preHandler: sessionAuthMiddleware },
    async (request: any, reply) => {
      try {
        const organizationId = request.organization.id;
        const { id: sessionId } = request.params;

        // Verify the session belongs to this organization
        const [session] = await db
          .select()
          .from(whatsappSession)
          .where(
            and(
              eq(whatsappSession.id, sessionId),
              eq(whatsappSession.organizationId, organizationId)
            )
          )
          .limit(1);

        if (!session) {
          return reply.status(404).send({
            error: 'Session not found',
            code: 'SESSION_NOT_FOUND',
          });
        }

        // Generate pairing code using BaileysManager
        const pairingCode = await fastify.baileys.generatePairingCode(sessionId, organizationId);

        return reply.send({
          success: true,
          sessionId,
          pairingCode,
          message: 'Enter this code in your WhatsApp to complete the connection',
        });
      } catch (error) {
        fastify.log.error('Error generating pairing code:', error);
        return reply.status(500).send({
          error: 'Failed to generate pairing code',
          code: 'PAIRING_CODE_GENERATION_FAILED',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );

  // Group syncing route
  fastify.post(
    '/accounts/:id/sync-groups',
    { preHandler: sessionAuthMiddleware },
    async (request: any, reply) => {
      try {
        const organizationId = request.organization.id;
        const { id: sessionId } = request.params;

        // Verify the session belongs to this organization
        const [session] = await db
          .select()
          .from(whatsappSession)
          .where(
            and(
              eq(whatsappSession.id, sessionId),
              eq(whatsappSession.organizationId, organizationId)
            )
          )
          .limit(1);

        if (!session) {
          return reply.status(404).send({ error: 'Session not found' });
        }

        // Call the BaileysManager to fetch and sync groups
        const result = await fastify.baileys.fetchAndSyncGroups(sessionId, organizationId);

        if (result.error) {
          return reply.status(400).send({
            error: 'Failed to sync groups',
            message: result.error,
            synced: result.synced,
          });
        }

        return reply.send({
          success: true,
          message: `Successfully synced ${result.synced} groups`,
          synced: result.synced,
        });
      } catch (error) {
        fastify.log.error('Error syncing groups:', error);
        return reply.status(500).send({
          error: 'Internal server error',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );

  // Contacts syncing route
  fastify.post(
    '/accounts/:id/sync-contacts',
    { preHandler: sessionAuthMiddleware },
    async (request: any, reply) => {
      try {
        const organizationId = request.organization.id;
        const { id: sessionId } = request.params;

        // Verify the session belongs to this organization
        const [session] = await db
          .select()
          .from(whatsappSession)
          .where(
            and(
              eq(whatsappSession.id, sessionId),
              eq(whatsappSession.organizationId, organizationId)
            )
          )
          .limit(1);

        if (!session) {
          return reply.status(404).send({ error: 'Session not found' });
        }

        // Call the BaileysManager to fetch and sync contacts
        const result = await fastify.baileys.fetchAndSyncContacts(sessionId, organizationId);

        if (result.error) {
          return reply.status(400).send({
            error: 'Failed to sync contacts',
            message: result.error,
            synced: result.synced,
          });
        }

        return reply.send({
          success: true,
          message: `Successfully synced ${result.synced} contacts`,
          synced: result.synced,
        });
      } catch (error) {
        fastify.log.error('Error syncing contacts:', error);
        return reply.status(500).send({
          error: 'Internal server error',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );

  // Real-time status updates via Server-Sent Events
  fastify.get(
    '/status-updates',
    { preHandler: sessionAuthMiddleware },
    async (request: any, reply) => {
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': process.env.APP_URL,
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Headers': 'Cache-Control',
      });

      const organizationId = request.organization.id;
      // const subscriber = fastify.redis.duplicate();

      // // Subscribe to WhatsApp session events for this organization
      // await subscriber.psubscribe('whatsapp:session:*');

      // const heartbeat = setInterval(() => {
      //   const heartbeatData = { type: 'heartbeat', timestamp: new Date().toISOString() };
      //   fastify.log.info(heartbeatData, 'Sending SSE heartbeat:');
      //   reply.raw.write(`data: ${JSON.stringify(heartbeatData)}\n\n`);
      // }, 10000); // Reduced to 10 seconds for testing

      // subscriber.on('pmessage', async (_pattern, channel, message) => {
      //   try {
      //     const eventData = JSON.parse(message);
      //     const sessionId = channel.split(':')[2];

      //     fastify.log.info(
      //       {
      //         event: eventData.event,
      //         organizationId,
      //         channel,
      //         data: eventData.data,
      //       },
      //       `SSE received event for session ${sessionId}:`
      //     );

      //     // Check if session belongs to this organization with direct database query
      //     const [session] = await db
      //       .select()
      //       .from(whatsappSession)
      //       .where(
      //         and(
      //           eq(whatsappSession.id, sessionId),
      //           eq(whatsappSession.organizationId, organizationId)
      //         )
      //       )
      //       .limit(1);

      //     if (session) {
      //       const statusUpdate = {
      //         type: 'status_update',
      //         sessionId,
      //         event: eventData.event,
      //         data: eventData.data,
      //         timestamp: eventData.timestamp,
      //       };

      //       fastify.log.info(statusUpdate, `Sending SSE event to frontend:`);
      //       reply.raw.write(`data: ${JSON.stringify(statusUpdate)}\n\n`);
      //     } else {
      //       fastify.log.info(
      //         `Session ${sessionId} does not belong to organization ${organizationId}, skipping event`
      //       );
      //     }
      //   } catch (error) {
      //     fastify.log.error(
      //       'Error processing SSE event: ' +
      //         (error instanceof Error ? error.message : String(error))
      //     );
      //   }
      // });

      request.raw.on('close', () => {
        clearInterval(heartbeat);
        subscriber.quit();
      });
    }
  );

  // Message routes
  // Get messages for admin panel
  fastify.get('/messages', { preHandler: sessionAuthMiddleware }, getMessages);

  // Get messages by contact for chat page (session authenticated)
  fastify.get('/messages/contact/:phone', { preHandler: sessionAuthMiddleware }, getMessagesByContact);

  // Message sending routes
  // Internal route for admin panel - require session auth
  fastify.post('/internal/send', { preHandler: sessionAuthMiddleware }, internalSendMessage);

  // Public API route - require API key
  fastify.post('/send', { preHandler: apiKeyAuthMiddleware }, sendMessage);

  // GET endpoint for sending messages via URL parameters
  fastify.get('/send', async (request: FastifyRequest, reply) => {
    try {
      // Get API key from either URL parameter or header
      const queryParams = request.query as any;
      const apiKey = queryParams.apiKey || request.headers['x-api-key'];

      if (!apiKey) {
        return reply.status(401).send({
          error: 'API key required',
          code: 'API_KEY_REQUIRED',
          message: 'Provide API key via ?apiKey=your-key or X-API-Key header',
        });
      }

      // Set the API key in the request headers for the sendMessage handler
      request.headers['x-api-key'] = apiKey as string;

      // Set the request body from query parameters
      (request as any).body = {
        to: queryParams.to,
        message: queryParams.message,
        type: queryParams.type || 'text',
        mediaUrl: queryParams.mediaUrl,
        fileName: queryParams.fileName,
        caption: queryParams.caption,
        replyMessageId: queryParams.replyMessageId,
      };

      // Call the existing sendMessage handler
      return sendMessage(request, reply);
    } catch (error) {
      request.log.error('GET /send error:', error);
      return reply.status(500).send({
        error: 'Failed to send message',
        code: 'SEND_MESSAGE_FAILED',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });
};

export default whatsappRoutes;
