import Fastify, { FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';
import redis from '@fastify/redis';
import env from '@fastify/env';
import dotenv from 'dotenv';

// Import plugins
// import betterAuthPlugin from './plugins/betterAuth';
import apikeyMiddleware from './plugins/apikeyMiddleware';
import analyticsMiddleware from './plugins/analyticsMiddleware';

// Import routes
import authRoutes from './routes/auth';
import organizationRoutes from './routes/organizations';
import whatsappRoutes from './routes/whatsapp';
import messageRoutes from './routes/messages';
import mediaRoutes from './routes/media';
import billingRoutes from './routes/billing';
import contactsRoutes from './routes/contacts';
import scheduledRoutes from './routes/scheduled';
import analyticsRoutes from './routes/analytics';

// Import plugins
import baileysPlugin from './plugins/baileys';
import storagePlugin from './plugins/storage';
import billingPlugin from './plugins/billing';
import { envSchema } from './schema/env';
import { auth } from './lib/auth';

// Import services
import { schedulerService } from './services/schedulerService';

dotenv.config();

const fastify = Fastify({
  logger:
    process.env['NODE_ENV'] === 'development'
      ? {
          level: 'info',
          transport: {
            target: 'pino-pretty',
            options: {
              translateTime: 'HH:MM:ss Z',
              ignore: 'pid,hostname',
            },
          },
        }
      : { level: 'warn' },
});

async function start() {
  try {
    // Register environment plugin first
    await fastify.register(env, {
      schema: envSchema,
      dotenv: true,
    });

    // Register core plugins
    await fastify.register(helmet, {
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'https:'],
        },
      },
    });

    await fastify.register(cors, {
      origin:
        fastify.config.NODE_ENV === 'development'
          ? ['http://localhost:3000', 'http://localhost:3001'] // Admin & Web portals
          : ['https://api.newton.ink', 'https://www.newton.ink', 'https://newton.ink'],
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Requested-With',
        'X-Api-Key',
        'X-Organization-Id',
      ],
      credentials: true,
    });

    await fastify.register(sensible);

    await fastify.register(redis, {
      url: fastify.config.REDIS_URL,
    });

    // Register global analytics middleware hooks directly
    fastify.log.info('Server: Registering global analytics hooks...');

    // Pre-handler to capture request start time
    fastify.addHook('preHandler', async (request: FastifyRequest, reply) => {
      // Only track the messages send API endpoint
      if (request.url !== '/api/v1/messages/send' || request.method !== 'POST') {
        return;
      }

      fastify.log.info(
        `Global Analytics: Setting up tracking for ${request.method} ${request.url}`
      );
      (request as any).analyticsData = {
        startTime: Date.now(),
      };
    });

    // Response hook to log the API usage
    fastify.addHook('onResponse', async (request: FastifyRequest, reply) => {
      if (!(request as any).analyticsData) return;

      try {
        fastify.log.info(
          `Global Analytics: Processing response for ${request.method} ${request.url}`
        );

        const responseTime = Date.now() - (request as any).analyticsData.startTime;
        const success = reply.statusCode >= 200 && reply.statusCode < 400;

        // Extract organization context
        let organizationId = null;
        let apiKeyId = null;
        let whatsappSessionId = null;

        if ((request as any).apiKey) {
          organizationId = (request as any).apiKey.organizationId;
          apiKeyId = (request as any).apiKey.id;
          whatsappSessionId = (request as any).apiKey.whatsappAccountId;
        } else if ((request as any).organization?.id) {
          organizationId = (request as any).organization.id;
        }

        fastify.log.info(
          `Global Analytics: Organization context - organizationId: ${organizationId}, success: ${success}`
        );

        if (organizationId) {
          // Extract message-specific data from request body
          let requestBody = null;
          let messageType = null;
          let recipientNumber = null;
          let messageId = null;
          let errorCode = null;
          let errorMessage = null;

          // Parse request body if available
          if (request.body && typeof request.body === 'object') {
            requestBody = request.body;
            messageType = (request.body as any).type || 'text';
            recipientNumber = (request.body as any).to;
          }

          // Extract response data
          let responseBody = null;
          if (reply.getHeader('content-type')?.toString().includes('application/json')) {
            try {
              const payload = (reply as any).payload;
              if (payload && typeof payload === 'string' && payload.length < 5000) {
                const parsed = JSON.parse(payload);
                responseBody = parsed;

                if (parsed.messageId) {
                  messageId = parsed.messageId;
                }

                if (!success && parsed.error) {
                  errorMessage = parsed.error;
                  errorCode = parsed.code;
                }
              }
            } catch (e) {
              // Ignore parsing errors
            }
          }

          const { createId } = await import('@paralleldrive/cuid2');
          const { db } = await import('./db/drizzle');
          const { apiUsage } = await import('./db/schema/analytics');

          await db.insert(apiUsage).values({
            id: createId(),
            organizationId,
            apiKeyId,
            whatsappSessionId,
            endpoint: request.url,
            method: request.method,
            statusCode: reply.statusCode,
            responseTime,
            requestBody,
            responseBody,
            userAgent: request.headers['user-agent'] || null,
            ipAddress: request.ip,
            messageType,
            messageId,
            recipientNumber,
            errorCode,
            errorMessage,
            success,
          });

          fastify.log.info(
            `Global Analytics: Successfully saved data for ${request.method} ${request.url}`
          );
        } else {
          fastify.log.warn(
            `Global Analytics: No organization context for ${request.method} ${request.url}`
          );
        }
      } catch (error) {
        fastify.log.error(
          `Global Analytics: Error processing ${request.method} ${request.url}:`,
          error
        );
      }
    });

    // Register auth and middleware plugins
    // await fastify.register(betterAuthPlugin);
    await fastify.register(apikeyMiddleware);

    // Register service plugins
    await fastify.register(storagePlugin);
    await fastify.register(billingPlugin);
    await fastify.register(baileysPlugin);

    // Initialize scheduler with baileys manager
    schedulerService.setBaileysManager(fastify.baileys);

    // Register authentication endpoint
    fastify.route({
      method: ['GET', 'POST'],
      url: '/api/auth/*',
      async handler(request, reply) {
        try {
          // Construct request URL
          const url = new URL(request.url, fastify.config.BETTER_AUTH_URL);
          fastify.log.info(`AUTH HANDLER HIT: ${request.method} ${request.url}: ${url}`);

          // Convert Fastify headers to standard Headers object
          const headers = new Headers();
          Object.entries(request.headers).forEach(([key, value]) => {
            if (value) headers.append(key, value.toString());
          });

          // Create Fetch API-compatible request
          const req = new Request(url.toString(), {
            method: request.method,
            headers,
            body: request.body ? JSON.stringify(request.body) : null,
          });

          // Process authentication request
          const response = await auth.handler(req);

          // Forward response to client
          reply.status(response.status);
          response.headers.forEach((value, key) => reply.header(key, value));
          reply.send(response.body ? await response.text() : null);
        } catch (error) {
          fastify.log.error(
            'Authentication Error: ' + (error instanceof Error ? error.message : String(error))
          );
          reply.status(500).send({
            error: 'Internal authentication error',
            code: 'AUTH_FAILURE',
          });
        }
      },
    });

    // Register API routes
    await fastify.register(authRoutes, { prefix: '/api/v1' });
    await fastify.register(organizationRoutes, { prefix: '/api/v1/organizations' });
    await fastify.register(whatsappRoutes, { prefix: '/api/v1/whatsapp' });
    await fastify.register(messageRoutes, { prefix: '/api/v1/messages' });
    await fastify.register(mediaRoutes, { prefix: '/api/v1/media' });
    await fastify.register(billingRoutes, { prefix: '/api/v1/billing' });
    await fastify.register(contactsRoutes, { prefix: '/api/v1/contacts' });
    await fastify.register(scheduledRoutes, { prefix: '/api/v1/scheduled' });
    await fastify.register(analyticsRoutes, { prefix: '/api/v1/analytics' });

    // TODO: Add test endpoint after fixing middleware decorators

    // Health and status endpoints
    fastify.get('/health', async () => {
      return { status: 'ok', timestamp: new Date().toISOString() };
    });

    fastify.get('/api/v1/status', async () => {
      return {
        service: 'whatsapp-api',
        version: '1.0.0',
        environment: fastify.config.NODE_ENV,
        uptime: process.uptime(),
      };
    });

    await fastify.listen({
      port: fastify.config.PORT,
      host: '0.0.0.0',
    });

    console.log(`Server listening on port ${fastify.config.PORT}`);
    console.log(`📅 Scheduler service initialized and running`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

start();
