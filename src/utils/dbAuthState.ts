import { AuthenticationCreds, useMultiFileAuthState } from '@whiskeysockets/baileys';
import { db } from '../db/drizzle';
import { baileysAuthState } from '../db/schema/baileysAuthState';
import { eq } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import { FastifyInstance } from 'fastify';
import path from 'path';
import fs from 'fs';

/**
 * Recursively serialize Buffers to base64 for JSON storage
 */
function serializeCredentials(creds: AuthenticationCreds): any {
  if (Buffer.isBuffer(creds)) {
    return { __buffer: creds.toString('base64') };
  }

  if (creds === null || creds === undefined) {
    return creds;
  }

  if (Array.isArray(creds)) {
    return creds.map(item => serializeCredentials(item));
  }

  if (typeof creds === 'object') {
    const serialized: any = {};
    for (const [key, value] of Object.entries(creds)) {
      serialized[key] = serializeCredentials(value);
    }
    return serialized;
  }

  return creds;
}

/**
 * Recursively deserialize base64 strings back to Buffers
 */
function deserializeCredentials(data: any): any {
  if (data && typeof data === 'object' && data.__buffer && typeof data.__buffer === 'string') {
    return Buffer.from(data.__buffer, 'base64');
  }

  if (data === null || data === undefined) {
    return data;
  }

  if (Array.isArray(data)) {
    return data.map(item => deserializeCredentials(item));
  }

  if (typeof data === 'object') {
    const deserialized: any = {};
    for (const [key, value] of Object.entries(data)) {
      deserialized[key] = deserializeCredentials(value);
    }
    return deserialized;
  }

  return data;
}

/**
 * Database-backed authentication state for Baileys
 * Critical for Railway: Loads credentials from DB on startup to prevent key sync errors
 * Properly handles Buffer serialization/deserialization
 */
export async function useDbAuthState(sessionId: string, logger?: FastifyInstance['log']) {
  const log = logger || { info: console.log, error: console.error, warn: console.warn };

  log.info(`[useDbAuthState] Initializing auth state for session: ${sessionId}`);

  const sessionDir = path.join(process.cwd(), 'sessions', sessionId);

  // CRITICAL: Check database for existing credentials FIRST
  // This prevents "Key used already" errors when session directory is lost (Railway restart)
  let dbCreds: AuthenticationCreds | null = null;
  try {
    const existing = await db.query.baileysAuthState.findFirst({
      where: eq(baileysAuthState.sessionId, sessionId),
    });

    if (existing && existing.creds) {
      try {
        const parsed = JSON.parse(existing.creds);
        // Deserialize buffers from base64
        const deserialized = deserializeCredentials(parsed);

        // Only load if we have real credentials (not empty object)
        if (deserialized && Object.keys(deserialized).length > 0) {
          dbCreds = deserialized;
          log.info(`[useDbAuthState] LOADED credentials from DB for session ${sessionId} - fields: ${Object.keys(dbCreds).join(', ')}`);
        }
      } catch (parseErr) {
        log.warn(`[useDbAuthState] Failed to parse DB credentials:`, parseErr);
      }
    }
  } catch (error) {
    log.error(`[useDbAuthState] Error loading from database:`, error);
  }

  // If we have DB credentials and session dir exists, clear it to avoid conflicts
  if (dbCreds && fs.existsSync(sessionDir)) {
    log.info(`[useDbAuthState] Clearing session directory to use restored DB credentials`);
    try {
      fs.rmSync(sessionDir, { recursive: true, force: true });
    } catch (err) {
      log.warn(`[useDbAuthState] Failed to clear session dir:`, err);
    }
  }

  // Load multifile auth state
  const multiFileAuth = await useMultiFileAuthState(sessionDir);

  // CRITICAL: If we have DB credentials, restore them NOW before socket creation
  // This ensures session state matches what WhatsApp expects
  if (dbCreds) {
    log.info(`[useDbAuthState] Restoring credentials from DB into session state`);
    // Replace the empty multifile credentials with our DB credentials
    Object.assign(multiFileAuth.state.creds, dbCreds);
    // Also save back to multifile to ensure consistency
    await multiFileAuth.saveCreds(dbCreds);
  }

  log.info(`[useDbAuthState] Session state ready. Creds fields: ${Object.keys(multiFileAuth.state.creds).join(', ') || 'empty'}`);

  // Wrap saveCreds to sync to database
  const originalSaveCreds = multiFileAuth.saveCreds;
  const saveCreds = async (update: Partial<AuthenticationCreds>) => {
    // First save to multifile (handles session files)
    await originalSaveCreds(update);

    // Then sync to database for disaster recovery
    try {
      const creds = multiFileAuth.state.creds;
      // Serialize buffers to base64 before storing
      const serialized = serializeCredentials(creds);
      const credsJson = JSON.stringify(serialized);

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

      log.info(`[useDbAuthState] Synced credentials to database`);
    } catch (error) {
      log.error(`[useDbAuthState] Error syncing to database:`, error);
      // Don't throw - continue even if DB sync fails
    }
  };

  return {
    state: multiFileAuth.state,
    saveCreds,
  };
}
