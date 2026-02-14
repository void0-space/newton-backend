import 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    user?: {
      id: string;
      email: string;
      organizationId: string;
      role: string;
    };
    apiKey?: {
      id: string;
      organizationId: string;
      permissions: string[];
    };
    organization?: {
      id: string;
      name: string;
    };
  }

  interface FastifyInstance {
    config: {
      NODE_ENV: string;
      PORT: number;
      DATABASE_URL: string;
      REDIS_URL: string;
      BETTER_AUTH_SECRET: string;
      BETTER_AUTH_URL: string;
      ENCRYPTION_KEY: string;
      CLIENT_ORIGINS?: string;
      
      // Razorpay
      RZP_KEY_ID?: string;
      RZP_KEY_SECRET?: string;
      RZP_WEBHOOK_SECRET?: string;
      
      // Storage
      STORAGE_ENDPOINT?: string;
      STORAGE_ACCESS_KEY?: string;
      STORAGE_SECRET_KEY?: string;
      STORAGE_BUCKET: string;
      
      // Social auth (optional)
      GOOGLE_CLIENT_ID?: string;
      GOOGLE_CLIENT_SECRET?: string;
      GITHUB_CLIENT_ID?: string;
      GITHUB_CLIENT_SECRET?: string;
    };
    
    webhookQueue: {
      queueWebhook: (webhookConfig: any, payload: any) => Promise<string>;
      getJobStatus: (jobId: string) => Promise<any>;
    };
  }
}