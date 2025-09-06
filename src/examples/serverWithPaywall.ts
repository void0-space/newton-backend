import fastify from 'fastify';
import { usageResetJob } from '../jobs/usageResetJob';

// Example server setup with usage tracking integration
export async function createServer() {
  const server = fastify({
    logger: true
  });

  // Initialize usage reset job
  console.log('Starting usage reset job...');
  // The job is automatically initialized when imported

  // Register existing routes
  // server.register(messageRoutes, { prefix: '/api/v1/messages' });
  // server.register(protectedMessageRoutes, { prefix: '/api/v1/protected' });

  // Admin route to manually trigger usage reset (for testing)
  server.post('/admin/reset-usage', {
    preHandler: async (request, reply) => {
      // Add admin authentication here
      const authHeader = request.headers.authorization;
      if (authHeader !== 'Bearer admin-secret-key') {
        return reply.code(401).send({ error: 'Unauthorized' });
      }
    }
  }, async (request, reply) => {
    try {
      const body = request.body as any;
      
      if (body.organizationId) {
        // Reset specific organization
        await usageResetJob.resetOrganizationUsage(body.organizationId);
        reply.send({ 
          success: true, 
          message: `Usage reset for organization ${body.organizationId}` 
        });
      } else {
        // Trigger full reset check
        await usageResetJob.triggerManualReset();
        reply.send({ 
          success: true, 
          message: 'Manual usage reset completed' 
        });
      }
    } catch (error: any) {
      reply.code(500).send({ 
        error: 'Reset failed', 
        details: error.message 
      });
    }
  });

  // Health check endpoint with job status
  server.get('/health', async (request, reply) => {
    const jobStatus = usageResetJob.getStatus();
    
    reply.send({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      jobs: {
        usageReset: jobStatus
      }
    });
  });

  return server;
}

// Start server if this file is run directly
if (require.main === module) {
  const start = async () => {
    try {
      const server = await createServer();
      await server.listen({ port: 4001, host: '0.0.0.0' });
      console.log('Server started on port 4001');
    } catch (err) {
      console.error('Error starting server:', err);
      process.exit(1);
    }
  };
  
  start();
}