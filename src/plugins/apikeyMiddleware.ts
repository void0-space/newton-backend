import { FastifyPluginAsync } from 'fastify';
import { auth } from '../lib/auth';

declare module 'fastify' {
  interface FastifyRequest {
    apiKey?: {
      id: string;
      name: string;
      userId: string;
      organizationId?: string;
      whatsappAccountId?: string;
    };
  }
}

const apikeyMiddleware: FastifyPluginAsync = async fastify => {
  fastify.addHook('preHandler', async (request, reply) => {
    // Skip auth routes and health checks
    if (request.url.startsWith('/api/auth/') || request.url === '/health') {
      return;
    }

    // Check for API key in header
    const apiKeyHeader = request.headers['x-api-key'] as string;
    fastify.log.info(`API Key Header: ${apiKeyHeader}`);

    if (apiKeyHeader) {
      try {
        const apiKeyData = await auth.api.verifyApiKey({
          body: { key: apiKeyHeader },
        });

        if (apiKeyData.valid && apiKeyData.key) {
          const metadata = apiKeyData.key.metadata || {};

          request.apiKey = {
            id: apiKeyData.key.id,
            name: apiKeyData.key.name ?? 'Unknown',
            userId: apiKeyData.key.userId,
            organizationId: metadata['organizationId'] || undefined,
            whatsappAccountId: metadata['whatsappAccountId'] || undefined,
          };
        } else {
          return reply.status(401).send({
            error: 'Invalid API key',
            code: 'INVALID_API_KEY',
          });
        }
      } catch (error) {
        fastify.log.error('API key validation error: ' + (error instanceof Error ? error.message : String(error)));
        return reply.status(401).send({
          error: 'Invalid API key',
          code: 'INVALID_API_KEY',
        });
      }
    }
  });

  // Helper decorator to require API key
  fastify.decorate('requireApiKey', () => {
    return async (request: any, reply: any) => {
      if (!request.apiKey) {
        return reply.status(401).send({
          error: 'API key required',
          code: 'API_KEY_REQUIRED',
        });
      }
    };
  });

  // // Helper decorator to require organization
  // fastify.decorate('requireOrganization', () => {
  //   return async (request: any, reply: any) => {
  //     if (!request.organization) {
  //       return reply.status(400).send({
  //         error: 'Organization context required',
  //         code: 'ORGANIZATION_REQUIRED',
  //       });
  //     }
  //   };
  // });
};

declare module 'fastify' {
  interface FastifyInstance {
    requireApiKey(): (request: any, reply: any) => Promise<void>;
    requireOrganization(): (request: any, reply: any) => Promise<void>;
  }
}

export default apikeyMiddleware;
