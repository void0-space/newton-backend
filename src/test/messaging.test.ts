import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';
import redis from '@fastify/redis';

// Import plugins and routes
import betterAuthPlugin from '../plugins/betterAuth';
import apikeyMiddleware from '../plugins/apikeyMiddleware';
import baileysPlugin from '../plugins/baileys';
import authRoutes from '../routes/auth';
import organizationRoutes from '../routes/organizations';
import whatsappRoutes from '../routes/whatsapp';
import messageRoutes from '../routes/messages';

describe('Messaging API Tests', () => {
  let app: typeof Fastify;
  let authToken: string;
  let apiKey: string;
  let organizationId: string;
  let sessionId: string;

  beforeAll(async () => {
    // Mock Redis for testing
    vi.doMock('@fastify/redis', () => ({
      default: () => ({
        register: vi.fn(),
        redis: {
          publish: vi.fn(),
          duplicate: vi.fn(() => ({
            psubscribe: vi.fn(),
            on: vi.fn(),
            quit: vi.fn(),
          })),
        },
      }),
    }));

    // Mock Baileys for testing
    vi.doMock('@whiskeysockets/baileys', () => ({
      default: vi.fn(() => ({
        ev: {
          on: vi.fn(),
        },
        sendMessage: vi.fn().mockResolvedValue({
          key: { id: 'test-message-id' },
        }),
        logout: vi.fn(),
        end: vi.fn(),
      })),
      useMultiFileAuthState: vi.fn().mockResolvedValue({
        state: {},
        saveCreds: vi.fn(),
      }),
      DisconnectReason: {
        loggedOut: 'logged-out',
      },
    }));

    // Create test app
    app = Fastify({ logger: false });
    
    // Register plugins
    await app.register(helmet, { global: false });
    await app.register(cors);
    await app.register(sensible);
    
    // Mock Redis registration
    app.register(async function mockRedis(fastify) {
      fastify.decorate('redis', {
        publish: vi.fn(),
        duplicate: vi.fn(() => ({
          psubscribe: vi.fn(),
          on: vi.fn(),
          quit: vi.fn(),
        })),
      });
    });
    
    await app.register(betterAuthPlugin);
    await app.register(apikeyMiddleware);
    await app.register(baileysPlugin);
    
    // Register routes
    await app.register(authRoutes, { prefix: '/api/v1' });
    await app.register(organizationRoutes, { prefix: '/api/v1/organizations' });
    await app.register(whatsappRoutes, { prefix: '/api/v1/whatsapp' });
    await app.register(messageRoutes, { prefix: '/api/v1/messages' });

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('should register user and create organization', async () => {
    // Register user
    const userResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up',
      payload: {
        name: 'Test User',
        email: 'test@example.com',
        password: 'password123',
      },
    });

    expect(userResponse.statusCode).toBe(200);
    const userData = JSON.parse(userResponse.payload);
    authToken = userData.session.token;

    // Create organization
    const orgResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/organizations',
      headers: { authorization: `Bearer ${authToken}` },
      payload: {
        name: 'Test Organization',
        slug: 'test-org',
      },
    });

    expect(orgResponse.statusCode).toBe(201);
    const orgData = JSON.parse(orgResponse.payload);
    organizationId = orgData.data.id;
  });

  it('should create API key', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/api-keys',
      headers: { authorization: `Bearer ${authToken}` },
      payload: {
        name: 'Test API Key',
        organizationId,
      },
    });

    expect(response.statusCode).toBe(200);
    const data = JSON.parse(response.payload);
    apiKey = data.data.key;
  });

  it('should create WhatsApp session', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/whatsapp/sessions',
      headers: {
        'x-api-key': apiKey,
        'x-organization-id': organizationId,
      },
      payload: { name: 'Test Session' },
    });

    expect(response.statusCode).toBe(201);
    const data = JSON.parse(response.payload);
    expect(data.success).toBe(true);
    expect(data.data.organizationId).toBe(organizationId);
    sessionId = data.data.id;
  });

  it('should send text message', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/messages/send',
      headers: {
        'x-api-key': apiKey,
        'x-organization-id': organizationId,
      },
      payload: {
        sessionId,
        to: '+919876543210',
        message: 'Hello, this is a test message!',
        type: 'text',
      },
    });

    expect(response.statusCode).toBe(200);
    const data = JSON.parse(response.payload);
    expect(data.success).toBe(true);
    expect(data.data.messageId).toBeDefined();
    expect(data.data.status).toBe('sent');
    expect(data.data.content).toBe('Hello, this is a test message!');
  });

  it('should send media message', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/messages/send/media',
      headers: {
        'x-api-key': apiKey,
        'x-organization-id': organizationId,
      },
      payload: {
        sessionId,
        to: '+919876543210',
        mediaUrl: 'https://example.com/image.jpg',
        type: 'image',
        caption: 'Test image caption',
      },
    });

    expect(response.statusCode).toBe(200);
    const data = JSON.parse(response.payload);
    expect(data.success).toBe(true);
    expect(data.data.type).toBe('image');
    expect(data.data.caption).toBe('Test image caption');
  });

  it('should get messages for organization', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/messages?limit=10',
      headers: {
        'x-api-key': apiKey,
        'x-organization-id': organizationId,
      },
    });

    expect(response.statusCode).toBe(200);
    const data = JSON.parse(response.payload);
    expect(data.success).toBe(true);
    expect(Array.isArray(data.data.messages)).toBe(true);
    expect(data.data.pagination).toBeDefined();
  });

  it('should get messages for specific session', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/messages/session/${sessionId}`,
      headers: {
        'x-api-key': apiKey,
        'x-organization-id': organizationId,
      },
    });

    expect(response.statusCode).toBe(200);
    const data = JSON.parse(response.payload);
    expect(data.success).toBe(true);
    expect(data.data.sessionId).toBe(sessionId);
    expect(Array.isArray(data.data.messages)).toBe(true);
  });

  it('should get WhatsApp sessions', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/whatsapp/sessions',
      headers: {
        'x-api-key': apiKey,
        'x-organization-id': organizationId,
      },
    });

    expect(response.statusCode).toBe(200);
    const data = JSON.parse(response.payload);
    expect(data.success).toBe(true);
    expect(Array.isArray(data.data)).toBe(true);
    expect(data.data.some((s: any) => s.id === sessionId)).toBe(true);
  });

  it('should require API key for message endpoints', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/messages/send',
      headers: { 'x-organization-id': organizationId },
      payload: {
        sessionId,
        to: '+919876543210',
        message: 'Unauthorized message',
      },
    });

    expect(response.statusCode).toBe(401);
    const data = JSON.parse(response.payload);
    expect(data.code).toBe('API_KEY_REQUIRED');
  });

  it('should require organization context', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/messages/send',
      headers: { 'x-api-key': apiKey },
      payload: {
        sessionId,
        to: '+919876543210',
        message: 'No organization message',
      },
    });

    expect(response.statusCode).toBe(400);
    const data = JSON.parse(response.payload);
    expect(data.code).toBe('ORGANIZATION_REQUIRED');
  });

  it('should validate message payload', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/messages/send',
      headers: {
        'x-api-key': apiKey,
        'x-organization-id': organizationId,
      },
      payload: {
        sessionId,
        // Missing 'to' and 'message' fields
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it('should disconnect WhatsApp session', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: `/api/v1/whatsapp/sessions/${sessionId}`,
      headers: {
        'x-api-key': apiKey,
        'x-organization-id': organizationId,
      },
    });

    expect(response.statusCode).toBe(200);
    const data = JSON.parse(response.payload);
    expect(data.success).toBe(true);
  });
});