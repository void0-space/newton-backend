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
import tusPlugin from './plugins/tus';

// Import routes
import authRoutes from './routes/auth';
import organizationRoutes from './routes/organizations';
import whatsappRoutes from './routes/whatsapp';
import messageRoutes from './routes/messages';
import mediaRoutes from './routes/media';
import contactsRoutes from './routes/contacts';
import groupRoutes from './routes/groups';
import scheduledRoutes from './routes/scheduled';
import analyticsRoutes from './routes/analytics';
import autoReplyRoutes from './routes/autoReply';
import campaignRoutes from './routes/campaigns';
import webhookRoutes from './routes/webhooks.js';

// Import plugins
import baileysPlugin from './plugins/baileys';
import storagePlugin from './plugins/storage';
import { envSchema } from './schema/env';
import { auth } from './lib/auth';

// Import services
import { schedulerService } from './services/schedulerService';

dotenv.config();

const logBufferSize = parseInt(process.env['LOG_BUFFER_SIZE'] || '256000', 10);
const logFlushInterval = parseInt(process.env['LOG_FLUSH_INTERVAL_MS'] || '2000', 10);

const fastify = Fastify({
  logger:
    process.env['NODE_ENV'] === 'development'
      ? {
          level: 'info',
          // Pino buffer configuration to prevent "Buffer timeout reached" errors
          bufferSize: logBufferSize,
          flushInterval: logFlushInterval,
          transport: {
            target: 'pino-pretty',
            options: {
              translateTime: 'HH:MM:ss Z',
              ignore: 'pid,hostname',
              // Don't buffer in pino-pretty, let pino handle it
              singleLine: false,
              colorize: true,
            },
          },
        }
      : {
          level: 'warn',
          // Production: larger buffer and faster flush
          bufferSize: logBufferSize * 2, // 512KB by default
          flushInterval: logFlushInterval / 2, // 1000ms by default
        },
});

console.log('[Logger Configuration]', {
  bufferSize: logBufferSize,
  flushInterval: logFlushInterval,
  nodeEnv: process.env['NODE_ENV'],
});

async function start() {
  try {
    // Register environment plugin first
    await fastify.register(env, {
      schema: envSchema,
      dotenv: true,
    });

    // Register TUS plugin FIRST before any CORS plugins
    await fastify.register(tusPlugin);

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
      origin: (origin, callback) => {
        // Always allow these origins
        const allowedOrigins = process.env.CORS_DOMAINS.split(',');

        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error('Not allowed by CORS'), false);
        }
      },
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH', 'HEAD'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Requested-With',
        'X-Api-Key',
        'X-Organization-Id',
        // TUS headers for resumable uploads
        'tus-resumable',
        'tus-version',
        'tus-max-size',
        'tus-extension',
        'upload-length',
        'upload-offset',
        'upload-metadata',
        'upload-defer-length',
        'upload-concat',
        'upload-checksum',
      ],
      exposedHeaders: [
        // TUS headers for resumable uploads
        'tus-resumable',
        'tus-version',
        'tus-max-size',
        'tus-extension',
        'upload-length',
        'upload-offset',
        'upload-metadata',
        'location',
      ],
      credentials: true,
    });

    await fastify.register(sensible);

    await fastify.register(redis, {
      url: fastify.config.REDIS_URL,
    });

    // Register global analytics middleware hooks directly
    // Pre-handler to capture request start time
    fastify.addHook('preHandler', async (request: FastifyRequest, reply) => {
      // Only track the messages send API endpoint
      if (request.url !== '/api/v1/messages/send' || request.method !== 'POST') {
        return;
      }

      (request as any).analyticsData = {
        startTime: Date.now(),
      };
    });

    // Response hook to log the API usage
    fastify.addHook('onResponse', async (request: FastifyRequest, reply) => {
      if (!(request as any).analyticsData) return;

      try {
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
        }
      } catch (error) {
        fastify.log.error('Analytics error:', error);
      }
    });

    // Register auth and middleware plugins
    // await fastify.register(betterAuthPlugin);
    await fastify.register(apikeyMiddleware);

    // Register service plugins
    await fastify.register(storagePlugin);
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

          // Convert Fastify headers to standard Headers object
          const headers = new Headers();
          Object.entries(request.headers).forEach(([key, value]) => {
            if (value) headers.append(key, value.toString());
          });

          // Create Fetch API-compatible request
          const req = new Request(url.toString(), {
            method: request.method,
            headers,
            body: request.body ? JSON.stringify(request.body) : undefined,
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
    await fastify.register(contactsRoutes, { prefix: '/api/v1/contacts' });
    await fastify.register(groupRoutes, { prefix: '/api/v1/groups' });
    await fastify.register(scheduledRoutes, { prefix: '/api/v1/scheduled' });
    await fastify.register(analyticsRoutes, { prefix: '/api/v1/analytics' });
    await fastify.register(autoReplyRoutes, { prefix: '/api/v1' });
    await fastify.register(campaignRoutes, { prefix: '/api/v1/campaigns' });
    await fastify.register(webhookRoutes, { prefix: '/api/v1/webhooks' });

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
