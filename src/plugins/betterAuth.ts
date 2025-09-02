import { FastifyPluginAsync } from 'fastify';
import { auth } from '../lib/auth';

declare module 'fastify' {
  interface FastifyRequest {
    user?: typeof auth.$Infer.Session.user;
    session?: typeof auth.$Infer.Session;
    organization?: {
      id: string;
      name: string;
      slug?: string;
    };
  }
}

const betterAuthPlugin: FastifyPluginAsync = async fastify => {
  // Auth handler function
  const authHandler = async (request: any, reply: any) => {
    try {
      fastify.log.info(`AUTH HANDLER HIT: ${request.method} ${request.url}`);

      // Construct request URL
      const url = new URL(request.url, `http://${request.headers.host}`);

      // Convert Fastify headers to standard Headers object
      const headers = new Headers();
      Object.entries(request.headers).forEach(([key, value]) => {
        if (value) {
          headers.append(key, value.toString());
        }
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
  };

  // Register auth routes using fastify.register with prefix
  await fastify.register(
    async function (authRouter) {
      authRouter.all('/*', authHandler);
    },
    { prefix: '/api/auth' }
  );

  // Add session/user context to requests using proper better-auth approach
  fastify.addHook('preHandler', async request => {
    // Skip auth routes and health checks
    if (request.url.startsWith('/api/auth/') || request.url === '/health') {
      return;
    }

    try {
      // Create a fake request object that better-auth can use to extract session from cookies
      const headers = new Headers();
      Object.entries(request.headers).forEach(([key, value]) => {
        if (value) {
          headers.append(key, Array.isArray(value) ? value[0] : value.toString());
        }
      });

      // Use better-auth to get session from cookies
      const session = await auth.api.getSession({
        headers: headers,
      });

      if (session?.user) {
        request.user = session.user;
        request.session = session;

        // Set organization from user session if available
        if (session.session?.activeOrganizationId) {
          request.organization = {
            id: session.session.activeOrganizationId,
            name: '', // Could be populated with a DB query if needed
          };
        }
      }
    } catch (error) {
      fastify.log.debug(
        'Session validation failed: ' + (error instanceof Error ? error.message : String(error))
      );
    }
  });
};

export default betterAuthPlugin;
