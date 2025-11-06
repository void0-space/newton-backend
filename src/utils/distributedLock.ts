import { FastifyInstance } from 'fastify';
import Redlock from 'redlock';

/**
 * Distributed lock manager for multi-replica deployments
 * Uses Redis Redlock to serialize JID-specific operations across all instances
 */
export class DistributedLockManager {
  private redlock: Redlock;

  constructor(fastify: FastifyInstance) {
    // Use Fastify's existing Redis connection for Redlock
    this.redlock = new Redlock([fastify.redis as any], {
      driftFactor: 0.01, // 1% drift
      retryCount: 0, // Fail fast - don't wait for retry
      retryDelay: 200,
      retryJitter: 200,
    });
  }

  /**
   * Acquire a distributed lock for a JID and execute function
   * 5 second TTL is plenty for a single decrypt + persist operation
   * If lock cannot be acquired immediately, throws an error (fail-fast)
   */
  async withJidLock<T>(jid: string, fn: () => Promise<T>): Promise<T> {
    const lockKey = `wa:lock:${jid}`;
    const lock = await this.redlock.acquire([lockKey], 5_000); // 5s TTL

    try {
      return await fn();
    } finally {
      // Release lock, but don't fail if it's already expired
      await lock.release().catch(() => {});
    }
  }
}
