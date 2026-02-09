import { FastifyPluginCallback } from 'fastify';
import fp from 'fastify-plugin';

const rateLimitMiddleware: FastifyPluginCallback = (fastify, options, done) => {
  // Rate limiting configuration
  const RATE_LIMIT = {
    windowMs: 60 * 1000, // 1 minute window
    max: 100, // 100 requests per minute per IP
    message: 'Too many requests from this IP, please try again later.',
  };

  // In-memory store for rate limiting (for simplicity)
  const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

  fastify.decorate('rateLimit', async (request: any, reply: any) => {
    const ip = request.ip || request.socket?.remoteAddress;
    if (!ip) {
      return; // Skip rate limiting if IP not available
    }

    const now = Date.now();
    const key = `rate-limit:${ip}`;
    const entry = rateLimitStore.get(key);

    // Check if rate limit window has expired
    if (entry && now > entry.resetTime) {
      rateLimitStore.delete(key);
    }

    // Get or create entry
    const currentEntry = rateLimitStore.get(key) || {
      count: 0,
      resetTime: now + RATE_LIMIT.windowMs,
    };

    // Increment request count
    currentEntry.count++;
    rateLimitStore.set(key, currentEntry);

    // Check rate limit
    if (currentEntry.count > RATE_LIMIT.max) {
      const retryAfter = Math.ceil((currentEntry.resetTime - now) / 1000);
      reply.header('Retry-After', retryAfter.toString());
      reply.header('X-RateLimit-Limit', RATE_LIMIT.max.toString());
      reply.header('X-RateLimit-Remaining', '0');
      reply.header('X-RateLimit-Reset', Math.ceil(currentEntry.resetTime / 1000).toString());

      return reply.status(429).send({
        error: RATE_LIMIT.message,
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfter,
      });
    }

    // Set rate limit headers
    reply.header('X-RateLimit-Limit', RATE_LIMIT.max.toString());
    reply.header('X-RateLimit-Remaining', (RATE_LIMIT.max - currentEntry.count).toString());
    reply.header('X-RateLimit-Reset', Math.ceil(currentEntry.resetTime / 1000).toString());
  });

  done();
};

export default fp(rateLimitMiddleware);
