import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { admin, apiKey, organization } from 'better-auth/plugins';
import { db } from '../db/drizzle';

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'pg',
  }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false, // Set to true in production
  },
  socialProviders: {
    google: {
      clientId: process.env['GOOGLE_CLIENT_ID'] || '',
      clientSecret: process.env['GOOGLE_CLIENT_SECRET'] || '',
      enabled: !!process.env['GOOGLE_CLIENT_ID'],
    },
    github: {
      clientId: process.env['GITHUB_CLIENT_ID'] || '',
      clientSecret: process.env['GITHUB_CLIENT_SECRET'] || '',
      enabled: !!process.env['GITHUB_CLIENT_ID'],
    },
  },
  plugins: [organization(), admin(), apiKey({ enableMetadata: true })],
  secret: process.env['BETTER_AUTH_SECRET']!,
  baseURL: process.env['BETTER_AUTH_URL'] || 'http://localhost:4001',
  advanced: {
    crossSubDomainCookies: {
      enabled: process.env['NODE_ENV'] === 'production',
      domain: 'newton.ink', // your domain
    },
    useSecureCookies: true,
  },
  trustedOrigins: [
    'http://localhost:3000', // Admin dashboard
    'http://localhost:3001', // Web portal
    'http://localhost:4001', // Backend
    'https://newton.ink',
    'https://www.newton.ink',
    'https://api.newton.ink',
  ],
});

export type Session = typeof auth.$Infer.Session;
export type User = typeof auth.$Infer.Session.user;
