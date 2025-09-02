// Environment schema for validation and type safety
export const envSchema = {
  type: 'object',
  required: ['DATABASE_URL', 'BETTER_AUTH_SECRET', 'ENCRYPTION_KEY'],
  properties: {
    NODE_ENV: { type: 'string', default: 'development' },
    PORT: { type: 'number', default: 4001 },
    DATABASE_URL: { type: 'string' },
    REDIS_URL: { type: 'string', default: 'redis://localhost:6379' },
    BETTER_AUTH_SECRET: { type: 'string' },
    BETTER_AUTH_URL: { type: 'string', default: 'http://localhost:4001' },
    ENCRYPTION_KEY: { type: 'string' },
    CLIENT_ORIGINS: { type: 'string' },

    // Razorpay
    RZP_KEY_ID: { type: 'string' },
    RZP_KEY_SECRET: { type: 'string' },
    RZP_WEBHOOK_SECRET: { type: 'string' },

    // Storage
    STORAGE_ENDPOINT: { type: 'string' },
    STORAGE_ACCESS_KEY: { type: 'string' },
    STORAGE_SECRET_KEY: { type: 'string' },
    STORAGE_BUCKET: { type: 'string', default: 'whatsapp-media' },

    // Social auth (optional)
    GOOGLE_CLIENT_ID: { type: 'string' },
    GOOGLE_CLIENT_SECRET: { type: 'string' },
    GITHUB_CLIENT_ID: { type: 'string' },
    GITHUB_CLIENT_SECRET: { type: 'string' },
  },
};
