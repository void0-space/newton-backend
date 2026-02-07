// Environment schema for validation and type safety
export const envSchema = {
  type: 'object',
  required: ['DATABASE_URL', 'BETTER_AUTH_SECRET', 'ENCRYPTION_KEY'],
  properties: {
    NODE_ENV: { type: 'string', default: 'development' },
    PORT: { type: 'number', default: 4001 },
    DATABASE_URL: { type: 'string' },
    REDIS_URL: { type: 'string' },
    BETTER_AUTH_SECRET: { type: 'string' },
    BETTER_AUTH_URL: { type: 'string', default: 'http://localhost:4001' },
    ENCRYPTION_KEY: { type: 'string' },
    CORS_DOMAINS: { type: 'string' },

    // Database pool configuration
    DB_POOL_MAX: { type: 'number', default: 20 },
    DB_POOL_IDLE_TIMEOUT_MS: { type: 'number', default: 30000 },
    DB_POOL_CONNECTION_TIMEOUT_MS: { type: 'number', default: 10000 },
    DB_STATEMENT_TIMEOUT_MS: { type: 'number', default: 300000 },

    // Logger buffer configuration (Pino)
    LOG_BUFFER_SIZE: { type: 'number', default: 256000 },
    LOG_FLUSH_INTERVAL_MS: { type: 'number', default: 2000 },

    // Storage (legacy)
    STORAGE_ENDPOINT: { type: 'string' },
    STORAGE_ACCESS_KEY: { type: 'string' },
    STORAGE_SECRET_KEY: { type: 'string' },
    STORAGE_BUCKET: { type: 'string', default: 'whatsapp-media' },

    // Cloudflare R2
    CLOUDFLARE_ACCOUNT_ID: { type: 'string' },
    CLOUDFLARE_R2_ACCESS_KEY_ID: { type: 'string' },
    CLOUDFLARE_R2_SECRET_ACCESS_KEY: { type: 'string' },
    CLOUDFLARE_R2_BUCKET: { type: 'string' },

    // Social auth (optional)
    GOOGLE_CLIENT_ID: { type: 'string' },
    GOOGLE_CLIENT_SECRET: { type: 'string' },
    GITHUB_CLIENT_ID: { type: 'string' },
    GITHUB_CLIENT_SECRET: { type: 'string' },
  },
};
