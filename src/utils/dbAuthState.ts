import { AuthenticationCreds, useMultiFileAuthState } from '@whiskeysockets/baileys';
import { db } from '../db/drizzle';
import { baileysAuthState } from '../db/schema/baileysAuthState';
import { eq } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import { FastifyInstance } from 'fastify';
import path from 'path';
import fs from 'fs';

/**
 * Database-backed authentication state for Baileys
 * Simple approach: Use multifile for everything, periodically sync to database
 */
export async function useDbAuthState(sessionId: string, logger?: FastifyInstance['log']) {
  const log = logger || { info: console.log, error: console.error, warn: console.warn };

  log.info(`[useDbAuthState] Initializing auth state for session: ${sessionId}`);

  const sessionDir = path.join(process.cwd(), 'sessions', sessionId);

  // Load multifile auth state (handles everything - creds, keys, session files)
  const multiFileAuth = await useMultiFileAuthState(sessionDir);

  log.info(`[useDbAuthState] Loaded multifile auth state. Creds fields: ${Object.keys(multiFileAuth.state.creds).join(', ') || 'empty'}`);

  // Wrap saveCreds to also save to database
  const originalSaveCreds = multiFileAuth.saveCreds;
  const saveCreds = async (update: Partial<AuthenticationCreds>) => {
    // First save to multifile (handles all complexity)
    await originalSaveCreds(update);

    // Then sync credentials to database for backup/persistence
    try {
      const creds = multiFileAuth.state.creds;
      const credsJson = JSON.stringify(creds);

      const existing = await db.query.baileysAuthState.findFirst({
        where: eq(baileysAuthState.sessionId, sessionId),
      });

      if (existing) {
        await db
          .update(baileysAuthState)
          .set({
            creds: credsJson,
            keys: '{}',
            updatedAt: new Date(),
          })
          .where(eq(baileysAuthState.sessionId, sessionId));
      } else {
        await db.insert(baileysAuthState).values({
          id: createId(),
          sessionId,
          creds: credsJson,
          keys: '{}',
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }

      log.info(`[useDbAuthState] Synced credentials to database for session ${sessionId}`);
    } catch (error) {
      log.error(`[useDbAuthState] Error syncing to database:`, error);
      // Don't throw - let connection continue even if DB sync fails
    }
  };

  log.info(`[useDbAuthState] Returning auth state for session ${sessionId}`);
  return {
    state: multiFileAuth.state,
    saveCreds,
  };
}
