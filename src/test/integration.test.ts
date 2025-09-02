import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';

// Import plugins and routes
import betterAuthPlugin from '../plugins/betterAuth';
import apikeyMiddleware from '../plugins/apikeyMiddleware';
import authRoutes from '../routes/auth';
import organizationRoutes from '../routes/organizations';

describe('API Integration Tests', () => {
  let app: typeof Fastify;
  let authToken: string;
  let organizationId: string;

  beforeAll(async () => {
    // Create test app
    app = Fastify({ logger: false });
    
    // Register plugins
    await app.register(helmet, { global: false });
    await app.register(cors);
    await app.register(sensible);
    
    await app.register(betterAuthPlugin);
    await app.register(apikeyMiddleware);
    
    // Register routes
    await app.register(authRoutes, { prefix: '/api/v1' });
    await app.register(organizationRoutes, { prefix: '/api/v1/organizations' });

    // Health endpoints
    app.get('/health', async () => ({ status: 'ok' }));

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('should return health status', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);
    const payload = JSON.parse(response.payload);
    expect(payload.status).toBe('ok');
  });

  it('should register a new user', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up',
      payload: {
        name: 'Test User',
        email: 'test@example.com',
        password: 'password123',
      },
    });

    expect(response.statusCode).toBe(200);
    const payload = JSON.parse(response.payload);
    expect(payload.user).toBeDefined();
    expect(payload.user.email).toBe('test@example.com');
    expect(payload.session).toBeDefined();
    
    // Store auth token for subsequent tests
    authToken = payload.session.token;
  });

  it('should create an organization', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/organizations',
      headers: {
        authorization: `Bearer ${authToken}`,
      },
      payload: {
        name: 'Test Organization',
        slug: 'test-org',
      },
    });

    expect(response.statusCode).toBe(201);
    const payload = JSON.parse(response.payload);
    expect(payload.success).toBe(true);
    expect(payload.data.name).toBe('Test Organization');
    expect(payload.data.slug).toBe('test-org');
    
    organizationId = payload.data.id;
  });

  it('should create an API key', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/api-keys',
      headers: {
        authorization: `Bearer ${authToken}`,
      },
      payload: {
        name: 'Test API Key',
        organizationId,
      },
    });

    expect(response.statusCode).toBe(200);
    const payload = JSON.parse(response.payload);
    expect(payload.success).toBe(true);
    expect(payload.data.name).toBe('Test API Key');
    expect(payload.data.key).toBeDefined();
    expect(typeof payload.data.key).toBe('string');
  });

  it('should list API keys', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/api-keys',
      headers: {
        authorization: `Bearer ${authToken}`,
      },
    });

    expect(response.statusCode).toBe(200);
    const payload = JSON.parse(response.payload);
    expect(payload.success).toBe(true);
    expect(Array.isArray(payload.data)).toBe(true);
    expect(payload.data.length).toBeGreaterThan(0);
    expect(payload.data[0].name).toBe('Test API Key');
  });

  it('should require authentication for protected routes', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/api-keys',
      payload: {
        name: 'Unauthorized Key',
      },
    });

    expect(response.statusCode).toBe(401);
    const payload = JSON.parse(response.payload);
    expect(payload.code).toBe('AUTH_REQUIRED');
  });

  // API key validation tests would require a protected endpoint to test against
  // These tests can be added when we have actual protected endpoints
});