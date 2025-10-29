import { AuthenticationCreds, useMultiFileAuthState } from '@whiskeysockets/baileys';
import { db } from '../db/drizzle';
import { baileysAuthState } from '../db/schema/baileysAuthState';
import { eq } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import { FastifyInstance } from 'fastify';
import path from 'path';
import fs from 'fs';

/**
 * Recursively serialize all Buffers and TypedArrays to base64
 * This replacer visits EVERY value in the object tree
 */
function serializeBuffers(_key: string, value: any): any {
  if (Buffer.isBuffer(value)) {
    return {
      __type: 'Buffer',
      __data: value.toString('base64'),
    };
  }
  // Handle all ArrayBuffer views (Uint8Array, etc)
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    return {
      __type: 'Uint8Array',
      __data: Buffer.from(value as Uint8Array).toString('base64'),
    };
  }
  return value;
}

/**
 * Recursively restore all Buffer markers back to Buffer instances
 * Walks the entire object tree AFTER JSON.parse to ensure nothing is missed
 */
function restoreBuffers(obj: any): any {
  if (obj === null || obj === undefined) {
    return obj;
  }

  // If this is a Buffer marker, convert it back
  if (
    obj &&
    typeof obj === 'object' &&
    obj.__type === 'Buffer' &&
    typeof obj.__data === 'string'
  ) {
    return Buffer.from(obj.__data, 'base64');
  }

  // If this is a Uint8Array marker, convert it back
  if (
    obj &&
    typeof obj === 'object' &&
    obj.__type === 'Uint8Array' &&
    typeof obj.__data === 'string'
  ) {
    return new Uint8Array(Buffer.from(obj.__data, 'base64'));
  }

  // If it's an array, process each element
  if (Array.isArray(obj)) {
    return obj.map(item => restoreBuffers(item));
  }

  // If it's an object, recursively process all properties
  if (typeof obj === 'object') {
    const restored: any = {};
    for (const [key, value] of Object.entries(obj)) {
      restored[key] = restoreBuffers(value);
    }
    return restored;
  }

  // Primitive values pass through unchanged
  return obj;
}

/**
 * Database-backed authentication state for Baileys
 * Properly persists credentials across Railway deployments
 * Uses aggressive Buffer serialization/deserialization
 */
export async function useDbAuthState(sessionId: string, logger?: FastifyInstance['log']) {
  const log = logger || { info: console.log, error: console.error, warn: console.warn };

  log.info(`[useDbAuthState] Initializing auth state for session: ${sessionId}`);

  const sessionDir = path.join(process.cwd(), 'sessions', sessionId);

  // CRITICAL: Try to load credentials from database first
  let dbCreds: AuthenticationCreds | null = null;
  try {
    const existing = await db.query.baileysAuthState.findFirst({
      where: eq(baileysAuthState.sessionId, sessionId),
    });

    if (existing && existing.creds) {
      try {
        // Parse JSON first
        const parsed = JSON.parse(existing.creds);
        // Then recursively restore ALL Buffers
        const restored = restoreBuffers(parsed);

        // Validate we have real credentials
        if (restored && Object.keys(restored).length > 0) {
          dbCreds = restored;
          log.info(`[useDbAuthState] ✅ LOADED credentials from database for session ${sessionId}`);
          log.info(`[useDbAuthState] Credential fields: ${Object.keys(dbCreds).join(', ')}`);
        }
      } catch (parseErr) {
        log.warn(`[useDbAuthState] Failed to parse database credentials:`, parseErr);
      }
    }
  } catch (error) {
    log.error(`[useDbAuthState] Error loading from database:`, error);
  }

  // If we have database credentials, clear session directory to use them
  if (dbCreds && fs.existsSync(sessionDir)) {
    log.info(`[useDbAuthState] Clearing session directory to use restored credentials`);
    try {
      fs.rmSync(sessionDir, { recursive: true, force: true });
    } catch (err) {
      log.warn(`[useDbAuthState] Failed to clear session directory:`, err);
    }
  }

  // Initialize multifile auth state
  const multiFileAuth = await useMultiFileAuthState(sessionDir);

  // If we have database credentials, restore them into the session
  if (dbCreds) {
    log.info(`[useDbAuthState] Restoring database credentials into session state`);
    Object.assign(multiFileAuth.state.creds, dbCreds);
    // Also save back to multifile
    await multiFileAuth.saveCreds(dbCreds);
    log.info(`[useDbAuthState] ✅ Successfully restored credentials from database`);
  }

  log.info(`[useDbAuthState] Session initialized. Creds fields: ${Object.keys(multiFileAuth.state.creds).join(', ') || 'empty'}`);

  // Wrap saveCreds to persist to database
  const originalSaveCreds = multiFileAuth.saveCreds;
  const saveCreds = async (update: Partial<AuthenticationCreds>) => {
    // First save to multifile
    await originalSaveCreds(update);

    // Then persist to database with proper Buffer serialization
    try {
      const creds = multiFileAuth.state.creds;

      // Use replacer to convert all Buffers to base64
      const credsJson = JSON.stringify(creds, serializeBuffers);

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
        log.info(`[useDbAuthState] Persisted credentials update to database`);
      } else {
        await db.insert(baileysAuthState).values({
          id: createId(),
          sessionId,
          creds: credsJson,
          keys: '{}',
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        log.info(`[useDbAuthState] Created credentials record in database`);
      }
    } catch (error) {
      log.error(`[useDbAuthState] Error persisting to database:`, error);
      // Don't throw - let connection continue
    }
  };

  log.info(`[useDbAuthState] Auth state ready for session ${sessionId}`);
  return {
    state: multiFileAuth.state,
    saveCreds,
  };
}
