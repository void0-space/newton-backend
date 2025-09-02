import { FastifyRequest, FastifyReply } from 'fastify';
import { auth } from '../lib/auth';
import { z } from 'zod';
import { convertHeaders } from '../utils/header';

const createApiKeySchema = z.object({
  name: z.string().min(1, 'API key name is required'),
  organizationId: z.string().optional(),
  whatsappAccountId: z.string().optional(),
  expiresIn: z.number().optional(), // seconds
  permissions: z.array(z.string()).optional(),
  rateLimitMax: z.number().optional(),
  rateLimitTimeWindow: z.number().optional(),
  remaining: z.number().optional(),
});

export async function createApiKey(request: FastifyRequest, reply: FastifyReply) {
  request.log.info(request.body, 'request body');
  try {
    const {
      name,
      whatsappAccountId,
      expiresIn,
      permissions,
      rateLimitMax,
      rateLimitTimeWindow,
      remaining,
    } = createApiKeySchema.parse(request.body);
    const headers = convertHeaders(request);
    const authSession = await auth.api.getSession({ headers });

    // Ensure user is authenticated
    if (!request.user) {
      return reply.status(401).send({
        error: 'Authentication required',
        code: 'AUTH_REQUIRED',
      });
    }

    // Prepare metadata
    const metadata = {
      organizationId: authSession?.session?.activeOrganizationId,
      whatsappAccountId,
    };

    // Create API key using better-auth with all fields
    const apiKey = await auth.api.createApiKey({
      body: {
        name,
        userId: request.user.id,
        prefix: name.toLowerCase().replace(/[^a-z0-9]/g, '-'),
        expiresIn: expiresIn || 60 * 60 * 24 * 30, // Default 30 days
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
        permissions: permissions ? { whatsapp: permissions } : { whatsapp: ['whatsapp:send'] },
        rateLimitEnabled: true,
        rateLimitMax: rateLimitMax || 100,
        rateLimitTimeWindow: rateLimitTimeWindow || 60 * 60 * 1000, // 1 hour in ms
        remaining: remaining || 1000,
        refillAmount: remaining || 1000,
        refillInterval: 60 * 60 * 24 * 1000, // Daily refill
      },
    });

    return reply.send({
      success: true,
      data: {
        id: apiKey.id,
        name: apiKey.name,
        key: apiKey.key, // This will only be shown once
        createdAt: apiKey.createdAt,
        expiresAt: apiKey.expiresAt,
        metadata: metadata,
        permissions: permissions || ['whatsapp:send'],
        rateLimitMax: rateLimitMax || 100,
        remaining: remaining || 1000,
      },
    });
  } catch (error) {
    request.log.error(
      'Error creating API key: ' + (error instanceof Error ? error.message : String(error))
    );
    return reply.status(500).send({
      error: 'Failed to create API key',
      code: 'CREATE_API_KEY_FAILED',
    });
  }
}

export async function listApiKeys(request: FastifyRequest, reply: FastifyReply) {
  try {
    if (!request.user) {
      return reply.status(401).send({
        error: 'Authentication required',
        code: 'AUTH_REQUIRED',
      });
    }

    const apiKeys = await auth.api.listApiKeys();

    return reply.send({
      success: true,
      data: apiKeys.map(key => ({
        id: key.id,
        name: key.name,
        lastUsedAt: key.createdAt, // Use createdAt as lastUsedAt is not available
        createdAt: key.createdAt,
        enabled: key.enabled,
      })),
    });
  } catch (error) {
    request.log.error(
      'Error listing API keys: ' + (error instanceof Error ? error.message : String(error))
    );
    return reply.status(500).send({
      error: 'Failed to list API keys',
      code: 'LIST_API_KEYS_FAILED',
    });
  }
}

export async function revokeApiKey(request: FastifyRequest, reply: FastifyReply) {
  try {
    const { id } = request.params as { id: string };

    if (!request.user) {
      return reply.status(401).send({
        error: 'Authentication required',
        code: 'AUTH_REQUIRED',
      });
    }

    // Revoke API key using better-auth
    const result = await auth.api.revokeApiKey({
      body: {
        keyId: id,
      },
    });

    if (!result) {
      return reply.status(404).send({
        error: 'API key not found',
        code: 'API_KEY_NOT_FOUND',
      });
    }

    return reply.send({
      success: true,
      message: 'API key revoked successfully',
      data: {
        id: result.id,
        revokedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    request.log.error(
      'Error revoking API key: ' + (error instanceof Error ? error.message : String(error))
    );
    return reply.status(500).send({
      error: 'Failed to revoke API key',
      code: 'REVOKE_API_KEY_FAILED',
    });
  }
}
