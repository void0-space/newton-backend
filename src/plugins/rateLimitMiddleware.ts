import { FastifyPluginCallback } from 'fastify';
import fp from 'fastify-plugin';

interface TokenBucket {
  tokens: number;
  lastRefill: number;
}

const rateLimitMiddleware: FastifyPluginCallback = (fastify, options, done) => {
  // Rate limiting configuration with burst support
  const RATE_LIMIT = {
    windowMs: 60 * 1000, // 1 minute window
    max: 100, // 100 requests per minute
    burst: 50, // Allow 50 extra requests in a burst
    tokensPerSecond: 100 / 60, // ~1.666 tokens per second
    message: 'Too many requests from this IP, please try again later.',
  };

  // Token bucket store per IP
  const tokenBuckets = new Map<string, TokenBucket>();

  fastify.decorate('rateLimit', async (request: any, reply: any) => {
    const ip = request.ip || request.socket?.remoteAddress;
    if (!ip) {
      return; // Skip rate limiting if IP not available
    }

    const now = Date.now();
    const key = `rate-limit:${ip}`;
    
    // Get or create token bucket for IP
    let bucket = tokenBuckets.get(key);
    if (!bucket) {
      bucket = {
        tokens: RATE_LIMIT.max + RATE_LIMIT.burst, // Full bucket on first request
        lastRefill: now,
      };
      tokenBuckets.set(key, bucket);
    }

    // Refill tokens based on time elapsed
    const timeElapsed = now - bucket.lastRefill;
    const tokensToAdd = (timeElapsed / 1000) * RATE_LIMIT.tokensPerSecond;
    
    if (tokensToAdd > 0) {
      bucket.tokens = Math.min(
        bucket.tokens + tokensToAdd, 
        RATE_LIMIT.max + RATE_LIMIT.burst
      );
      bucket.lastRefill = now;
    }

    // Check if we have available tokens
    if (bucket.tokens < 1) {
      const refillTime = Math.ceil((1 - bucket.tokens) / RATE_LIMIT.tokensPerSecond);
      const retryAfter = Math.ceil(refillTime);
      
      reply.header('Retry-After', retryAfter.toString());
      reply.header('X-RateLimit-Limit', RATE_LIMIT.max.toString());
      reply.header('X-RateLimit-Remaining', '0');
      reply.header('X-RateLimit-Reset', Math.ceil((now + refillTime * 1000) / 1000).toString());

      return reply.status(429).send({
        error: RATE_LIMIT.message,
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfter,
      });
    }

    // Consume one token
    bucket.tokens -= 1;

    // Set rate limit headers
    const remaining = Math.floor(bucket.tokens);
    const resetIn = Math.ceil((RATE_LIMIT.max - remaining) / RATE_LIMIT.tokensPerSecond);
    
    reply.header('X-RateLimit-Limit', RATE_LIMIT.max.toString());
    reply.header('X-RateLimit-Remaining', remaining.toString());
    reply.header('X-RateLimit-Reset', Math.ceil((now + resetIn * 1000) / 1000).toString());
  });

  done();
};

export default fp(rateLimitMiddleware);
