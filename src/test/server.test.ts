import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';

describe('Server Health Check', () => {
  it('should return health status', async () => {
    const fastify = Fastify();
    
    fastify.get('/health', async () => {
      return { status: 'ok', timestamp: new Date().toISOString() };
    });

    const response = await fastify.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);
    const payload = JSON.parse(response.payload);
    expect(payload.status).toBe('ok');
    expect(payload.timestamp).toBeDefined();

    await fastify.close();
  });

  it('should return API status', async () => {
    const fastify = Fastify();
    
    fastify.get('/api/v1/status', async () => {
      return {
        service: 'whatsapp-api',
        version: '1.0.0',
        environment: process.env.NODE_ENV,
        uptime: process.uptime(),
      };
    });

    const response = await fastify.inject({
      method: 'GET',
      url: '/api/v1/status',
    });

    expect(response.statusCode).toBe(200);
    const payload = JSON.parse(response.payload);
    expect(payload.service).toBe('whatsapp-api');
    expect(payload.version).toBe('1.0.0');

    await fastify.close();
  });
});