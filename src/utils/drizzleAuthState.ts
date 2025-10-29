import { eq } from 'drizzle-orm';
import { db } from '../db/drizzle';
import { baileysAuthState } from '../db/schema/baileysAuthState';
import {
  AuthenticationState,
  initAuthCreds,
  SignalDataTypeMap,
  BufferJSON,
} from '@whiskeysockets/baileys';
import { FastifyInstance } from 'fastify';

type KeyStore = { [T in keyof SignalDataTypeMap]?: Record<string, SignalDataTypeMap[T]> };

/**
 * Create a Drizzle-backed authentication state for Baileys
 * Uses JSONB columns and Baileys' own BufferJSON for serialization
 */
export async function createDrizzleAuthState(
  ns: string,
  logger?: FastifyInstance['log']
): Promise<AuthenticationState> {
  const log = logger || { info: console.log, error: console.error, warn: console.warn };

  log.info(`[drizzleAuthState] Creating auth state for namespace: ${ns}`);

  // Load existing state or initialize fresh
  async function load() {
    try {
      const row = await db.query.baileysAuthState.findFirst({
        where: eq(baileysAuthState.ns, ns),
      });

      if (!row) {
        log.info(`[drizzleAuthState] No existing state for ${ns}, creating fresh`);
        return {
          creds: initAuthCreds(),
          keys: {} as KeyStore,
        };
      }

      log.info(`[drizzleAuthState] Loaded existing state for ${ns}`);

      // Restore Buffers from JSONB data using Baileys' BufferJSON.reviver
      // JSONB stores objects, we need to stringify and parse with reviver to restore Buffers
      const restoredCreds = JSON.parse(JSON.stringify(row.creds), BufferJSON.reviver);
      const restoredKeys = JSON.parse(JSON.stringify(row.keys), BufferJSON.reviver);

      return {
        creds: restoredCreds,
        keys: restoredKeys,
      };
    } catch (error) {
      log.error(`[drizzleAuthState] Error loading state:`, error);
      return {
        creds: initAuthCreds(),
        keys: {} as KeyStore,
      };
    }
  }

  // Persist state to database
  async function persist(state: { creds: any; keys: KeyStore }) {
    try {
      const existing = await db.query.baileysAuthState.findFirst({
        where: eq(baileysAuthState.ns, ns),
      });

      // Serialize using BufferJSON.replacer to preserve Buffers in JSONB
      const serializedCreds = JSON.parse(JSON.stringify(state.creds, BufferJSON.replacer));
      const serializedKeys = JSON.parse(JSON.stringify(state.keys, BufferJSON.replacer));

      if (existing) {
        await db
          .update(baileysAuthState)
          .set({
            creds: serializedCreds,
            keys: serializedKeys,
            updatedAt: new Date(),
          })
          .where(eq(baileysAuthState.ns, ns));
        log.info(`[drizzleAuthState] Updated state for ${ns}`);
      } else {
        await db.insert(baileysAuthState).values({
          ns,
          creds: serializedCreds,
          keys: serializedKeys,
          updatedAt: new Date(),
        });
        log.info(`[drizzleAuthState] Created new state for ${ns}`);
      }
    } catch (error) {
      log.error(`[drizzleAuthState] Error persisting state:`, error);
      throw error;
    }
  }

  // Initialize the state
  const { creds, keys } = await load();
  const keyStore: KeyStore = keys || {};

  // Wrap all persistence
  async function saveAll() {
    await persist({ creds, keys: keyStore });
  }

  log.info(`[drizzleAuthState] Auth state ready. Creds fields: ${Object.keys(creds).join(', ') || 'empty'}`);

  return {
    creds,
    keys: {
      get: async (type, ids) => {
        const map = keyStore[type] || {};
        const out: any = {};
        for (const id of ids) {
          out[id] = map[id];
        }
        return out;
      },
      set: async (data) => {
        for (const _type in data) {
          const type = _type as keyof SignalDataTypeMap;
          keyStore[type] = keyStore[type] || {};
          Object.assign(keyStore[type]!, data[type]!);
        }
        await saveAll();
      },
    },
    saveCreds: saveAll,
  };
}
