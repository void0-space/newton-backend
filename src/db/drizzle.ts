import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import dotenv from 'dotenv';
import * as schema from './schema';

dotenv.config();

const pool = new Pool({
  connectionString: process.env['DATABASE_URL'],
  // Optimized connection pool to prevent saturation
  max: parseInt(process.env['DB_POOL_MAX'] || '10', 10), // Reduced from 20 to 10
  idleTimeoutMillis: parseInt(process.env['DB_POOL_IDLE_TIMEOUT_MS'] || '15000', 10), // Reduced from 30000 to 15000
  connectionTimeoutMillis: parseInt(process.env['DB_POOL_CONNECTION_TIMEOUT_MS'] || '10000', 10),
  statement_timeout: parseInt(process.env['DB_STATEMENT_TIMEOUT_MS'] || '180000', 10), // Reduced from 300000 to 180000
  application_name: 'whatsapp-api-backend',
  // Additional performance settings
  allowExitOnIdle: true,
  idle_in_transaction_session_timeout: 60000,
});

// Handle pool errors
pool.on('error', (err) => {
  console.error('[Pool Error]', err);
});

// Log pool configuration
console.log('[Database Pool Configuration]', {
  max: pool.options.max,
  idleTimeoutMillis: pool.options.idleTimeoutMillis,
  connectionTimeoutMillis: pool.options.connectionTimeoutMillis,
  statement_timeout: pool.options.statement_timeout,
});

export const db = drizzle(pool, { schema });
