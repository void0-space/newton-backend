import {
  default as makeWASocket,
  DisconnectReason,
  Browsers,
  ConnectionState,
  Contact,
  GroupMetadata,
  WAMessage,
  proto,
  WASocket,
  isJidBroadcast,
  isJidNewsletter,
  isJidStatusBroadcast,
  isJidMetaAI,
  isLidUser,
  jidNormalizedUser,
} from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import { FastifyInstance } from 'fastify';
import { db } from '../db/drizzle';
import { whatsappSession, message, contact, contactGroup } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { encryptData } from '../utils/crypto';
import { createId } from '@paralleldrive/cuid2';
import { WebhookService } from './webhookService';
import { AutoReplyService } from './autoReplyService';
import { createDrizzleAuthState } from '../utils/drizzleAuthState';
import PQueue from 'p-queue';
import { DistributedLockManager } from '../utils/distributedLock';

export interface BaileysSession {
  id: string;
  organizationId: string;
  socket: WASocket | null;
  qrCode: string | null;
  pairingCode: string | null;
  status: 'disconnected' | 'connecting' | 'connected' | 'qr_required';
  phoneNumber?: string;
  profileName?: string;
  profilePhoto?: string;
  lastActive: Date;
  createdAt?: Date;

  // Settings
  alwaysShowOnline?: boolean;
  autoRejectCalls?: boolean;
  antiBanSubscribe?: boolean;
  antiBanStrictMode?: boolean;
  webhookUrl?: string;
  webhookMethod?: string;
  manuallyDisconnected?: boolean;
}

export class BaileysManager {
  private sessions: Map<string, BaileysSession> = new Map();
  private fastify: FastifyInstance;
  private webhookService: WebhookService;
  private autoReplyService: AutoReplyService;

  // Per-JID message processing queues to prevent Signal protocol race conditions within a single instance
  // Key format: "sessionId:normalizedJid"
  private perJidQueue: Map<string, PQueue> = new Map();

  // Distributed lock manager for multi-replica deployments
  // Ensures only one replica processes messages from the same JID at a time
  private lockManager: DistributedLockManager;

  constructor(fastify: FastifyInstance) {
    this.fastify = fastify;
    this.webhookService = new WebhookService(fastify);
    this.autoReplyService = new AutoReplyService();
    this.autoReplyService.setBaileysManager(this);
    this.lockManager = new DistributedLockManager(fastify);
  }

  /**
   * Get or create a queue for a specific JID within a session
   * Ensures serialized message processing from the same sender
   */
  private getQueueFor(sessionId: string, jid: string): PQueue {
    const normalizedJid = jidNormalizedUser(jid);
    const queueKey = `${sessionId}:${normalizedJid}`;

    if (!this.perJidQueue.has(queueKey)) {
      // Concurrency of 1 ensures messages from same JID are processed sequentially
      this.perJidQueue.set(queueKey, new PQueue({ concurrency: 1 }));
    }

    return this.perJidQueue.get(queueKey)!;
  }

  async createSession(sessionId: string, organizationId: string): Promise<BaileysSession> {
    try {
      // Check if session already exists
      if (this.sessions.has(sessionId)) {
        throw new Error('Session already exists');
      }

      // Initialize auth state from database
      const ns = `baileys:${sessionId}`;
      const auth = await createDrizzleAuthState(ns, this.fastify.log);

      const session: BaileysSession = {
        id: sessionId,
        organizationId,
        socket: null,
        qrCode: null,
        pairingCode: null,
        status: 'connecting',
        lastActive: new Date(),
        manuallyDisconnected: false, // Clear manually disconnected flag when starting new session
        alwaysShowOnline: true, // Default to auto-reconnect
      };

      // Create WhatsApp socket
      const socket = makeWASocket({
        auth,
        logger: this.fastify.log,
        browser: Browsers.macOS('Desktop'),
        // V7 configuration - balanced timeouts
        defaultQueryTimeoutMs: 60000, // 60 second default query timeout
        maxRetries: 3, // Retry 3 times on transient failures
        connectTimeoutMs: 60000, // 60 second connection timeout
        shouldIgnoreJid: jid =>
          isJidBroadcast(jid) ||
          isJidNewsletter(jid) ||
          isJidStatusBroadcast(jid) ||
          isJidMetaAI(jid),
      });

      session.socket = socket;
      const sessionKey = `${organizationId}:${sessionId}`;
      this.sessions.set(sessionKey, session);

      // Handle connection events with proper context
      const sessionContext = { sessionId, organizationId, sessionKey };

      socket.ev.on('connection.update', update => {
        // Fire and forget - don't wait for completion
        this.handleConnectionUpdate(sessionContext, update).catch(err =>
          this.fastify.log.error('Error in handleConnectionUpdate:', err)
        );
      });

      // Handle credentials update
      socket.ev.on('creds.update', auth.saveCreds);

      // Handle messages with distributed + local serialization to prevent Signal protocol race conditions
      // Distributed lock ensures only one replica processes this JID
      // Local queue ensures serialization within this replica
      socket.ev.on('messages.upsert', messageUpdate => {
        // Only log message count, not full payload (reduces buffer pressure)
        this.fastify.log.debug(
          `🚀 messages.upsert event: ${messageUpdate.messages.length} messages for session ${sessionId}`
        );

        // Process messages grouped by sender JID to maintain Signal protocol state consistency
        for (const msg of messageUpdate.messages) {
          const senderJid = msg.key.remoteJid;
          if (senderJid) {
            const queue = this.getQueueFor(sessionId, senderJid);
            queue
              .add(async () => {
                // Acquire distributed lock to ensure only one replica processes this JID
                await this.lockManager
                  .withJidLock(senderJid, async () => {
                    try {
                      // Accessing msg.message triggers decryption - must be inside the lock
                      const _content = msg.message;
                      await this.handleMessages(sessionContext, {
                        messages: [msg],
                        type: messageUpdate.type,
                      });
                    } catch (err: any) {
                      // Log but don't surface as 500 - transient pkmsg failures are expected
                      // Baileys handles retry receipts for known failures
                      this.fastify.log.warn(
                        {
                          err: {
                            code: err?.code,
                            message: err?.message,
                          },
                          jid: senderJid,
                          sessionId,
                          messageId: msg.key.id,
                        },
                        'Message decrypt/process failed - will rely on client retry'
                      );
                      // Don't rethrow - let the client handle retry
                    }
                  })
                  .catch(lockErr => {
                    this.fastify.log.debug(
                      { jid: senderJid, sessionId },
                      'Failed to acquire distributed lock - another replica processing'
                    );
                  });
              })
              .catch(err => this.fastify.log.error('Error queuing message:', err));
          }
        }
      });

      // Handle message status updates
      socket.ev.on('messages.update', updates => {
        // Only log count, not full payload (reduces buffer pressure)
        this.fastify.log.debug(
          `🔄 messages.update: ${updates.length} updates for session ${sessionId}`
        );
        this.handleMessageUpdates(sessionContext, updates).catch(err =>
          this.fastify.log.error('Error in handleMessageUpdates:', err)
        );
      });

      // Handle contacts sync
      socket.ev.on('contacts.upsert', contacts => {
        // Only log count, not full payload (reduces buffer pressure)
        this.fastify.log.debug(
          `👥 contacts.upsert: ${contacts.length} contacts for session ${sessionId}`
        );
        this.handleContactsUpsert(sessionContext, contacts).catch(err =>
          this.fastify.log.error('Error in handleContactsUpsert:', err)
        );
      });

      this.fastify.log.info(`✅ Registered contacts.upsert listener for session ${sessionId}`);

      // Handle groups sync
      socket.ev.on('groups.upsert', groups => {
        // Only log count, not full payload (reduces buffer pressure)
        this.fastify.log.debug(
          `👫 groups.upsert: ${groups.length} groups for session ${sessionId}`
        );
        this.handleGroupsUpsert(sessionContext, groups).catch(err =>
          this.fastify.log.error('Error in handleGroupsUpsert:', err)
        );
      });

      // Save initial session to database
      await this.saveSessionToDb(session);

      // Don't force reconnection on timeout - let Baileys handle AwaitingInitialSync naturally
      // Forcing reconnection interrupts the initialization and causes inconsistent state
      // Baileys will emit connection.update events as state changes, we handle those

      return session;
    } catch (error) {
      this.fastify.log.error(error, `Failed to create session ${sessionId}:`);
      throw error;
    }
  }

  async getSession(sessionId: string, organizationId: string): Promise<BaileysSession | null> {
    // 1. Check in-memory sessions first
    const sessionKey = `${organizationId}:${sessionId}`;
    const memorySession = this.sessions.get(sessionKey);

    if (memorySession && memorySession.organizationId === organizationId) {
      return memorySession;
    }

    // 2. Check Redis cache
    const cacheKey = `session:${organizationId}:${sessionId}`;
    try {
      const cached = await this.fastify.redis.get(cacheKey);
      if (cached) {
        const cachedSession = JSON.parse(cached);
        // Don't restore socket from cache, just return metadata
        return {
          ...cachedSession,
          socket: null,
          lastActive: new Date(cachedSession.lastActive),
          createdAt: cachedSession.createdAt ? new Date(cachedSession.createdAt) : new Date(),
        };
      }
    } catch (cacheError) {
      this.fastify.log.warn(`Redis cache error for session ${sessionId}:`, cacheError);
      // Continue to database if cache fails
    }

    // 3. Check database
    const [dbSession] = await db
      .select()
      .from(whatsappSession)
      .where(
        and(eq(whatsappSession.id, sessionId), eq(whatsappSession.organizationId, organizationId))
      )
      .limit(1);

    if (!dbSession) {
      return null;
    }

    // Cache the database result
    await this.cacheSession(dbSession);

    // Don't restore manually disconnected sessions
    if (dbSession.manuallyDisconnected) {
      return {
        id: dbSession.id,
        organizationId: dbSession.organizationId,
        socket: null,
        qrCode: dbSession.qrCode,
        status: 'disconnected' as any,
        phoneNumber: dbSession.phoneNumber || undefined,
        lastActive: dbSession.lastActive || new Date(),
        createdAt: dbSession.createdAt || new Date(),
        alwaysShowOnline: dbSession.alwaysShowOnline ?? true,
        autoRejectCalls: dbSession.autoRejectCalls ?? false,
        antiBanSubscribe: dbSession.antiBanSubscribe ?? false,
        antiBanStrictMode: dbSession.antiBanStrictMode ?? false,
        webhookUrl: dbSession.webhookUrl || undefined,
        webhookMethod: dbSession.webhookMethod || 'POST',
        manuallyDisconnected: true,
      };
    }

    // Try to restore session if it's not in memory
    try {
      await this.restoreSession(dbSession);
      return this.sessions.get(sessionKey) || null;
    } catch (error) {
      this.fastify.log.error(`Failed to restore session ${sessionId}:`, error);
      return {
        id: dbSession.id,
        organizationId: dbSession.organizationId,
        socket: null,
        qrCode: dbSession.qrCode,
        status: dbSession.status as any,
        phoneNumber: dbSession.phoneNumber || undefined,
        lastActive: dbSession.lastActive || new Date(),
        createdAt: dbSession.createdAt || new Date(),
        alwaysShowOnline: dbSession.alwaysShowOnline ?? true,
        autoRejectCalls: dbSession.autoRejectCalls ?? false,
        antiBanSubscribe: dbSession.antiBanSubscribe ?? false,
        antiBanStrictMode: dbSession.antiBanStrictMode ?? false,
        webhookUrl: dbSession.webhookUrl || undefined,
        webhookMethod: dbSession.webhookMethod || 'POST',
        manuallyDisconnected: dbSession.manuallyDisconnected ?? false,
      };
    }
  }

  async disconnectSession(sessionId: string, organizationId: string): Promise<void> {
    this.fastify.log.info(`Starting manual disconnection for session ${sessionId}`);

    const sessionKey = `${organizationId}:${sessionId}`;
    const session = this.sessions.get(sessionKey);

    try {
      // First, update database to prevent reconnection
      await db
        .update(whatsappSession)
        .set({
          status: 'disconnected',
          manuallyDisconnected: true,
          updatedAt: new Date(),
        })
        .where(
          and(eq(whatsappSession.id, sessionId), eq(whatsappSession.organizationId, organizationId))
        );

      this.fastify.log.info(`Updated database for session ${sessionId} - manually disconnected`);

      if (session && session.organizationId === organizationId) {
        // Mark as manually disconnected to prevent auto-reconnection
        session.manuallyDisconnected = true;
        session.status = 'disconnected';

        if (session.socket) {
          try {
            // Don't call logout as it causes issues - just close the connection
            session.socket.end(undefined);
            this.fastify.log.info(`Closed socket for session ${sessionId}`);
          } catch (socketError) {
            this.fastify.log.warn(
              `Error closing socket for ${sessionId}: ${socketError instanceof Error ? socketError.message : String(socketError)}`
            );
          }
        }

        session.socket = null;

        // Save updated session state to database to ensure consistency
        await this.saveSessionToDb(session);

        this.sessions.delete(sessionKey);
      }

      // Publish disconnect event with more context
      await this.publishEvent(sessionId, 'disconnected', {
        reason: 'manual_disconnect',
        status: 'disconnected',
        manuallyDisconnected: true,
      });
      this.fastify.log.info(`Successfully disconnected session ${sessionId} and published event`);

      // Invalidate cache after disconnection
      await this.invalidateSessionCache(sessionId, organizationId);

      // Small delay to ensure database changes are committed
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      this.fastify.log.error(`Error in disconnectSession for ${sessionId}:`, error);
      throw error;
    }
  }

  async debugSessions(): Promise<any> {
    console.log(`🔍 Current sessions in memory:`, this.sessions.size);
    const sessionInfo = Array.from(this.sessions.entries()).map(([key, session]) => ({
      key,
      id: session.id,
      status: session.status,
      organizationId: session.organizationId,
      phoneNumber: session.phoneNumber,
      hasSocket: !!session.socket,
    }));
    console.log(`Session details:`, sessionInfo);
    return sessionInfo;
  }

  async listSessions(organizationId: string): Promise<BaileysSession[]> {
    const dbSessions = await db
      .select()
      .from(whatsappSession)
      .where(eq(whatsappSession.organizationId, organizationId));

    const result = dbSessions.map(dbSession => {
      const sessionKey = `${organizationId}:${dbSession.id}`;
      const memorySession = this.sessions.get(sessionKey);

      // If manually disconnected, always use database status regardless of memory session
      const finalStatus = dbSession.manuallyDisconnected
        ? 'disconnected'
        : memorySession?.status || dbSession.status;

      this.fastify.log.info(
        `Listing session ${dbSession.id}: ${JSON.stringify({
          sessionKey,
          hasMemorySession: !!memorySession,
          memoryStatus: memorySession?.status,
          dbStatus: dbSession.status,
          manuallyDisconnected: dbSession.manuallyDisconnected,
          finalStatus,
        })}`
      );

      return {
        id: dbSession.id,
        organizationId: dbSession.organizationId,
        socket: memorySession?.socket || null,
        qrCode: dbSession.qrCode,
        status: finalStatus as any,
        phoneNumber: dbSession.phoneNumber || undefined,
        profileName: dbSession.profileName || undefined,
        profilePhoto: dbSession.profilePhoto || undefined,
        lastActive: dbSession.lastActive || new Date(),
        createdAt: dbSession.createdAt || new Date(),
        alwaysShowOnline: dbSession.alwaysShowOnline ?? true,
        autoRejectCalls: dbSession.autoRejectCalls ?? false,
        antiBanSubscribe: dbSession.antiBanSubscribe ?? false,
        antiBanStrictMode: dbSession.antiBanStrictMode ?? false,
        webhookUrl: dbSession.webhookUrl || undefined,
        webhookMethod: dbSession.webhookMethod || 'POST',
        manuallyDisconnected: dbSession.manuallyDisconnected ?? false,
      };
    });

    this.fastify.log.info(
      `Returning ${result.length} sessions for org ${organizationId}: ${JSON.stringify({
        allMemorySessionKeys: Array.from(this.sessions.keys()),
      })}`
    );

    return result;
  }

  async fetchAndSyncGroups(
    sessionId: string,
    organizationId: string
  ): Promise<{ synced: number; error?: string }> {
    try {
      const sessionKey = `${organizationId}:${sessionId}`;
      const session = this.sessions.get(sessionKey);

      if (!session || !session.socket) {
        return { synced: 0, error: 'Session not found or not connected' };
      }

      this.fastify.log.info(`Fetching groups for session ${sessionId}...`);

      // Get all groups the user is participating in
      const groups = await session.socket.groupFetchAllParticipating();

      if (!groups || Object.keys(groups).length === 0) {
        this.fastify.log.info(`No groups found for session ${sessionId}`);
        return { synced: 0 };
      }

      // Convert groups object to array and process
      const groupArray = Object.values(groups);
      this.fastify.log.info(`Found ${groupArray.length} groups, syncing...`);

      await this.handleGroupsUpsert(
        { sessionId, organizationId, sessionKey },
        groupArray as GroupMetadata[]
      );

      return { synced: groupArray.length };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.fastify.log.error(`Error fetching groups for session ${sessionId}:`, error);
      return { synced: 0, error: errorMessage };
    }
  }

  async fetchAndSyncContacts(
    sessionId: string,
    organizationId: string
  ): Promise<{ synced: number; error?: string }> {
    try {
      const sessionKey = `${organizationId}:${sessionId}`;
      const session = this.sessions.get(sessionKey);

      if (!session || !session.socket) {
        return { synced: 0, error: 'Session not found or not connected' };
      }

      this.fastify.log.info(`Fetching contacts for session ${sessionId}...`);

      // Get all contacts from the socket
      const contactsMap = session.socket.contacts || {};
      const contactArray = Object.values(contactsMap) as any[];

      if (!contactArray || contactArray.length === 0) {
        this.fastify.log.info(`No contacts found for session ${sessionId}`);
        return { synced: 0 };
      }

      this.fastify.log.info(`Found ${contactArray.length} contacts, syncing...`);

      await this.handleContactsUpsert({ sessionId, organizationId, sessionKey }, contactArray);

      return { synced: contactArray.length };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.fastify.log.error(`Error fetching contacts for session ${sessionId}:`, error);
      return { synced: 0, error: errorMessage };
    }
  }

  private async handleConnectionUpdate(
    sessionContext: { sessionId: string; organizationId: string; sessionKey: string },
    update: Partial<ConnectionState>
  ) {
    const { sessionId, organizationId, sessionKey } = sessionContext;
    const session = this.sessions.get(sessionKey);

    if (!session) {
      this.fastify.log.error(`Session ${sessionId} not found in memory during connection update`);
      return;
    }

    const { connection, lastDisconnect, qr } = update;

    // Only log important state changes, not every update
    if (connection || qr || lastDisconnect?.error) {
      this.fastify.log.debug(
        `Connection update for session ${sessionId}: connection=${connection}, hasQR=${!!qr}, hasError=${!!lastDisconnect?.error}`
      );
    }

    if (qr) {
      this.fastify.log.info(`QR code generated for session ${sessionId}`);
      try {
        // Generate QR code
        const qrCodeUrl = await QRCode.toDataURL(qr);
        session.qrCode = qrCodeUrl;
        session.status = 'qr_required';

        this.fastify.log.info(`Session ${sessionId} status set to qr_required`);

        await this.saveSessionToDb(session);
        this.fastify.log.info(`Session ${sessionId} saved to database with QR code`);

        // Publish QR event to Redis
        await this.publishEvent(sessionId, 'qr_generated', { qrCode: qrCodeUrl });
        this.fastify.log.info(`Published qr_generated event for session ${sessionId}`);
      } catch (err) {
        this.fastify.log.error(`Error generating QR code for session ${sessionId}:`, err);
      }
    }

    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
      const errorMessage = lastDisconnect?.error?.message || '';

      this.fastify.log.info(
        `Session ${sessionId} disconnected with status: ${statusCode}, error: ${errorMessage}, manuallyDisconnected: ${session.manuallyDisconnected}, alwaysShowOnline: ${session.alwaysShowOnline}`
      );

      // Don't auto-reconnect if manually disconnected
      if (session.manuallyDisconnected) {
        session.status = 'disconnected';
        session.socket = null;
        session.qrCode = null;
        this.sessions.delete(sessionKey);

        await this.publishEvent(sessionId, 'disconnected', { reason: 'manual_disconnect' });
        await this.saveSessionToDb(session);
        return;
      }

      // Handle stream errors (code 515) during pairing - restart the connection
      if (errorMessage.includes('Stream Errored') || statusCode === 515) {
        this.fastify.log.info(
          `Stream error detected for session ${sessionId}, attempting restart...`
        );
        session.status = 'connecting';
        session.socket = null;

        await this.saveSessionToDb(session);
        await this.publishEvent(sessionId, 'connecting', { reason: 'stream_error_restart' });

        // Restart the connection after a short delay
        setTimeout(async () => {
          try {
            await this.recreateSocket({ sessionId, organizationId, sessionKey });
          } catch (error) {
            this.fastify.log.error(
              `Failed to restart session ${sessionId} after stream error:`,
              error
            );
          }
        }, 2000);
        return;
      }

      // Handle different disconnect reasons based on settings
      if (statusCode === DisconnectReason.loggedOut) {
        // User logged out - don't reconnect, require QR
        session.status = 'disconnected';
        session.socket = null;
        session.qrCode = null;
        this.sessions.delete(sessionKey);

        await this.publishEvent(sessionId, 'disconnected', { reason: 'logged_out' });
      } else if (statusCode === DisconnectReason.timedOut) {
        // Only reconnect if alwaysShowOnline is enabled AND not manually disconnected
        if (session.alwaysShowOnline && !session.manuallyDisconnected) {
          session.status = 'connecting';
          this.fastify.log.info(
            `Session ${sessionId} timed out, attempting reconnect in 10 seconds (Always Show Online enabled)`
          );

          setTimeout(() => {
            this.recreateSocket(sessionContext);
          }, 10000); // 10 second delay for timeout

          await this.publishEvent(sessionId, 'connecting', { reason: 'timeout_reconnect' });
        } else {
          session.status = 'disconnected';
          session.socket = null;
          this.sessions.delete(sessionKey);
          const reason = session.manuallyDisconnected
            ? 'manual_disconnect'
            : 'timeout_no_auto_reconnect';
          await this.publishEvent(sessionId, 'disconnected', { reason });
        }
      } else if (statusCode === 401 || statusCode === DisconnectReason.restartRequired) {
        // Device conflict or restart required - clean up and require QR
        session.status = 'qr_required';
        session.socket = null;
        session.qrCode = null;

        await this.publishEvent(sessionId, 'qr_required', { reason: 'device_conflict' });
      } else {
        // Other connection issues - only reconnect if alwaysShowOnline is enabled AND not manually disconnected
        if (session.alwaysShowOnline && !session.manuallyDisconnected) {
          session.status = 'connecting';
          this.fastify.log.info(
            `Session ${sessionId} disconnected, attempting reconnect in 3 seconds (Always Show Online enabled)`
          );

          setTimeout(() => {
            this.recreateSocket(sessionContext);
          }, 3000); // 3 second delay for other issues

          await this.publishEvent(sessionId, 'connecting', {
            reason: 'connection_lost_auto_reconnect',
          });
        } else {
          session.status = 'disconnected';
          session.socket = null;
          this.sessions.delete(sessionKey);
          const reason = session.manuallyDisconnected
            ? 'manual_disconnect'
            : 'connection_lost_no_auto_reconnect';
          await this.publishEvent(sessionId, 'disconnected', { reason });
        }
      }

      await this.saveSessionToDb(session);
    } else if (connection === 'open') {
      this.fastify.log.info(
        `Session ${sessionId} connection is now OPEN - setting status to connected`
      );
      session.status = 'connected';
      session.qrCode = null;
      session.phoneNumber = session.socket?.user?.id?.split(':')[0];
      session.lastActive = new Date();
      const [result] = await session.socket.onWhatsApp(session.socket.user.id);

      this.fastify.log.info(`👤 onWhatsApp result:${JSON.stringify(result)} ${session.socket}`);
      // Fetch profile information
      try {
        if (session.socket && session.phoneNumber) {
          this.fastify.log.info(
            `Fetching profile info for session ${sessionId}: ${JSON.stringify(session.socket.user)}`
          );
          const profileInfo = await session.socket.fetchStatus(session.socket.user?.id);
          session.profileName = session.socket.user?.notify || session.socket.user?.name || '-';
          // Try to get profile picture
          try {
            const ppUrl = await session.socket.profilePictureUrl(session.socket.user?.id, 'image');
            session.profilePhoto = ppUrl;
          } catch (ppError) {
            this.fastify.log.warn(`Failed to fetch profile picture for ${sessionId}:`, ppError);
            session.profilePhoto = undefined;
          }

          this.fastify.log.info(
            `Fetched profile info for ${sessionId}: profileName=${session.profileName}, hasProfilePhoto=${!!session.profilePhoto}`
          );
        }
      } catch (error) {
        this.fastify.log.warn(`Failed to fetch profile info for ${sessionId}:`, error);
      }

      this.fastify.log.info(`Session ${sessionId} updated:`, {
        status: session.status,
        phoneNumber: session.phoneNumber,
        profileName: session.profileName,
        hasSocket: !!session.socket,
      });

      await this.saveSessionToDb(session);
      this.fastify.log.info(`Session ${sessionId} saved to database with connected status`);

      // Publish connection event with profile info
      await this.publishEvent(sessionId, 'connected', {
        phoneNumber: session.phoneNumber,
        profileName: session.profileName,
        profilePhoto: session.profilePhoto,
      });

      this.fastify.log.info(`Published connected event for session ${sessionId}`);

      // Fetch and sync WhatsApp contacts after successful connection
      // In Baileys V7, we need to extract contacts from chats
      try {
        this.fastify.log.info(
          `Fetching WhatsApp contacts for newly connected session ${sessionId}...`
        );

        // Try to get contacts from socket store
        const allChats = (session.socket.store?.chats?.getAll?.() || []) as any[];
        const contactsMap = new Map<string, Contact>();

        // Extract unique contacts from chats
        for (const chat of allChats) {
          if (chat.id && !chat.id.includes('@g.us')) {
            // Skip group chats
            const contact = session.socket.contacts?.[chat.id];
            if (contact && contact.id) {
              contactsMap.set(chat.id, contact);
            }
          }
        }

        const contactArray = Array.from(contactsMap.values());
        this.fastify.log.info(
          `Found ${contactArray.length} contacts from chats for session ${sessionId}`
        );

        if (contactArray.length > 0) {
          await this.handleContactsUpsert({ sessionId, organizationId, sessionKey }, contactArray);
          this.fastify.log.info(
            `Successfully synced ${contactArray.length} contacts for session ${sessionId}`
          );
        } else {
          this.fastify.log.info(
            `No contacts found in chats for session ${sessionId}, waiting for contacts.upsert event`
          );
        }
      } catch (contactSyncError) {
        this.fastify.log.warn(
          `Failed to sync contacts for session ${sessionId}:`,
          contactSyncError
        );
        // Don't fail the connection if contact sync fails
      }

      // Fetch and sync WhatsApp groups after successful connection
      try {
        this.fastify.log.info(
          `Fetching WhatsApp groups for newly connected session ${sessionId}...`
        );
        const groupSyncResult = await this.fetchAndSyncGroups(sessionId, organizationId);
        this.fastify.log.info(
          `Successfully synced ${groupSyncResult.synced} groups for session ${sessionId}`,
          groupSyncResult
        );
      } catch (groupSyncError) {
        this.fastify.log.warn(`Failed to sync groups for session ${sessionId}:`, groupSyncError);
        // Don't fail the connection if group sync fails
      }

      // Ingest account.created event for usage tracking
      try {
        this.fastify.log.info(
          `🎯 Attempting to ingest account.created event for session ${sessionId} and organization ${session.organizationId}`
        );
        await this.ingestAccountCreatedEvent(session.organizationId, {
          sessionId,
          phoneNumber: session.phoneNumber,
          profileName: session.profileName,
          accountType: 'whatsapp',
        });
        this.fastify.log.info(
          `✅ Successfully ingested account.created event for session ${sessionId}`
        );
      } catch (ingestError) {
        this.fastify.log.error(
          `❌ Failed to ingest account.created event for session ${sessionId}:`,
          ingestError
        );
      }
    }
  }

  private async recreateSocket(sessionContext: {
    sessionId: string;
    organizationId: string;
    sessionKey: string;
  }) {
    const { sessionId, organizationId, sessionKey } = sessionContext;
    const session = this.sessions.get(sessionKey);

    this.fastify.log.info(`Recreating socket for session ${sessionId}:`, {
      foundSession: !!session,
      sessionKey,
      organizationId,
    });

    if (!session) {
      this.fastify.log.error(`Session ${sessionId} not found during socket recreation`);
      return;
    }

    try {
      const ns = `baileys:${sessionId}`;
      const auth = await createDrizzleAuthState(ns, this.fastify.log);

      const socket = makeWASocket({
        auth,
        logger: this.fastify.log,
        browser: Browsers.macOS('Desktop'),
        // V7 configuration - balanced timeouts
        defaultQueryTimeoutMs: 60000, // 60 second default query timeout
        maxRetries: 3, // Retry 3 times on transient failures
        connectTimeoutMs: 60000, // 60 second connection timeout
        shouldIgnoreJid: jid =>
          isJidBroadcast(jid) ||
          isJidNewsletter(jid) ||
          isJidStatusBroadcast(jid) ||
          isJidMetaAI(jid),
      });

      session.socket = socket;

      // Re-register event handlers
      socket.ev.on('connection.update', update => {
        this.handleConnectionUpdate(sessionContext, update).catch(err =>
          this.fastify.log.error('Error in handleConnectionUpdate:', err)
        );
      });
      socket.ev.on('creds.update', auth.saveCreds);
      // Handle messages with distributed + local serialization to prevent Signal protocol race conditions
      socket.ev.on('messages.upsert', messageUpdate => {
        for (const msg of messageUpdate.messages) {
          const senderJid = msg.key.remoteJid;
          if (senderJid) {
            const queue = this.getQueueFor(sessionId, senderJid);
            queue
              .add(async () => {
                await this.lockManager
                  .withJidLock(senderJid, async () => {
                    try {
                      const _content = msg.message; // Triggers decryption - must be inside lock
                      await this.handleMessages(sessionContext, {
                        messages: [msg],
                        type: messageUpdate.type,
                      });
                    } catch (err: any) {
                      this.fastify.log.warn(
                        {
                          err: { code: err?.code, message: err?.message },
                          jid: senderJid,
                          sessionId,
                          messageId: msg.key.id,
                        },
                        'Message decrypt/process failed - will rely on client retry'
                      );
                    }
                  })
                  .catch(lockErr => {
                    this.fastify.log.warn(
                      { err: lockErr, jid: senderJid, sessionId },
                      'Failed to acquire distributed lock for JID'
                    );
                  });
              })
              .catch(err => this.fastify.log.error('Error queuing message:', err));
          }
        }
      });
      socket.ev.on('messages.update', updates =>
        this.handleMessageUpdates(sessionContext, updates).catch(err =>
          this.fastify.log.error('Error in handleMessageUpdates:', err)
        )
      );
      socket.ev.on('contacts.upsert', contacts => {
        this.fastify.log.debug(
          `👥 contacts.upsert: ${contacts.length} contacts for session ${sessionId}`
        );
        this.handleContactsUpsert(sessionContext, contacts).catch(err =>
          this.fastify.log.error('Error in handleContactsUpsert:', err)
        );
      });
      socket.ev.on('groups.upsert', groups => {
        this.fastify.log.debug(
          `👫 groups.upsert: ${groups.length} groups for session ${sessionId}`
        );
        this.handleGroupsUpsert(sessionContext, groups).catch(err =>
          this.fastify.log.error('Error in handleGroupsUpsert:', err)
        );
      });

      this.fastify.log.info(
        `✅ Re-registered contacts and groups listeners in recreateSocket for ${sessionId}`
      );
    } catch (error) {
      this.fastify.log.error(`Failed to recreate socket for session ${sessionId}:`, error);
      session.status = 'disconnected';
      await this.saveSessionToDb(session);
    }
  }

  private async handleMessages(
    sessionContext: { sessionId: string; organizationId: string; sessionKey: string },
    messageUpdate: any
  ) {
    const { sessionId, sessionKey } = sessionContext;
    const session = this.sessions.get(sessionKey);

    console.log(`📥 handleMessages called for session ${sessionId}`);
    console.log(`Messages received:`, messageUpdate.messages?.length || 0);

    if (!session) {
      this.fastify.log.warn(`Session ${sessionId} not found for message handling`);
      return;
    }

    const messages = messageUpdate.messages;

    for (const msg of messages) {
      console.log(
        `Processing message - fromMe: ${msg.key.fromMe}, remoteJid: ${msg.key.remoteJid}`
      );
      if (!msg.key.fromMe) {
        console.log(`🔥 Incoming message detected! Processing...`);
        // Incoming message
        await this.saveIncomingMessage(session.organizationId, sessionId, msg);
      } else {
        console.log(`⚡ Outgoing message, skipping...`);
      }
    }
  }

  private async handleMessageUpdates(
    sessionContext: { sessionId: string; organizationId: string; sessionKey: string },
    updates: any[]
  ) {
    const { sessionId } = sessionContext;
    for (const update of updates) {
      // Update message status in database
      await this.updateMessageStatus(sessionId, update);
    }
  }

  private async saveIncomingMessage(organizationId: string, sessionId: string, msg: WAMessage) {
    try {
      console.log(`💾 saveIncomingMessage called for session ${sessionId}`);

      // Resolve LID to Phone Number if needed
      let fromJid = msg.key.remoteJid || '';
      const participantJid = msg.key.participant;

      // For DMs: Check if remoteJid is a LID and try to resolve it
      if (fromJid && isLidUser(fromJid)) {
        this.fastify.log.info(`🔍 Detected LID in remoteJid: ${fromJid}`);

        // Primary approach: Use remoteJidAlt if available (contains PN when main is LID)
        if (msg.key.remoteJidAlt) {
          fromJid = msg.key.remoteJidAlt;
          this.fastify.log.info(`✅ Resolved LID to PN using remoteJidAlt: ${fromJid}`);
        } else {
          // Fallback: Try to resolve using signalRepository.lidMapping
          const sessionKey = `${organizationId}:${sessionId}`;
          const session = this.sessions.get(sessionKey);

          if (session?.socket?.signalRepository?.lidMapping?.getPNForLID) {
            try {
              const resolvedPN = await session.socket.signalRepository.lidMapping.getPNForLID(fromJid);
              if (resolvedPN) {
                fromJid = resolvedPN;
                this.fastify.log.info(`✅ Resolved LID to PN using signalRepository: ${fromJid}`);
              } else {
                this.fastify.log.warn(`⚠️ Could not resolve LID to PN, using LID: ${fromJid}`);
              }
            } catch (err) {
              this.fastify.log.warn(`⚠️ Error resolving LID to PN: ${err instanceof Error ? err.message : String(err)}, using LID: ${fromJid}`);
            }
          } else {
            this.fastify.log.warn(`⚠️ signalRepository.lidMapping not available, using LID: ${fromJid}`);
          }
        }
      }

      // For Groups: Resolve participant LID if needed
      let resolvedParticipant = participantJid;
      if (participantJid && isLidUser(participantJid)) {
        this.fastify.log.info(`🔍 Detected LID in participant: ${participantJid}`);

        // Primary approach: Use participantAlt if available
        if (msg.key.participantAlt) {
          resolvedParticipant = msg.key.participantAlt;
          this.fastify.log.info(`✅ Resolved participant LID to PN using participantAlt: ${resolvedParticipant}`);
        } else {
          // Fallback: Try to resolve using signalRepository.lidMapping
          const sessionKey = `${organizationId}:${sessionId}`;
          const session = this.sessions.get(sessionKey);

          if (session?.socket?.signalRepository?.lidMapping?.getPNForLID) {
            try {
              const resolvedPN = await session.socket.signalRepository.lidMapping.getPNForLID(participantJid);
              if (resolvedPN) {
                resolvedParticipant = resolvedPN;
                this.fastify.log.info(`✅ Resolved participant LID to PN using signalRepository: ${resolvedParticipant}`);
              } else {
                this.fastify.log.warn(`⚠️ Could not resolve participant LID to PN, using LID: ${participantJid}`);
              }
            } catch (err) {
              this.fastify.log.warn(`⚠️ Error resolving participant LID to PN: ${err instanceof Error ? err.message : String(err)}, using LID: ${participantJid}`);
            }
          } else {
            this.fastify.log.warn(`⚠️ signalRepository.lidMapping not available for participant, using LID: ${participantJid}`);
          }
        }
      }

      const messageContent = {
        text: msg.message?.conversation || msg.message?.extendedTextMessage?.text,
        type: this.getMessageType(msg),
        timestamp: msg.messageTimestamp,
        participant: resolvedParticipant,
      };

      console.log(`📝 Message content:`, {
        text: messageContent.text,
        type: messageContent.type,
        from: fromJid,
        originalFrom: msg.key.remoteJid,
        participant: resolvedParticipant,
        originalParticipant: participantJid,
      });

      await db.insert(message).values({
        id: createId(),
        organizationId,
        sessionId,
        externalId: msg.key.id,
        direction: 'inbound',
        from: fromJid,
        to: sessionId,
        messageType: messageContent.type,
        content: messageContent,
        status: 'received',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Track usage for incoming message
      // Usage tracking removed

      // Publish message event
      await this.publishEvent(sessionId, 'message.received', {
        messageId: msg.key.id,
        from: fromJid,
        content: messageContent,
      });

      // Send webhook notification
      await this.webhookService.sendWebhook(
        organizationId,
        'message.received',
        {
          messageId: createId(),
          sessionId,
          from: fromJid,
          content: messageContent,
          timestamp: new Date(Number(msg.messageTimestamp) * 1000).toISOString(),
        },
        sessionId
      );

      // Process auto reply
      try {
        const incomingMessage = {
          messageId: msg.key.id || createId(),
          from: fromJid,
          text: messageContent.text || '',
          whatsappAccountId: sessionId,
          organizationId,
          timestamp: new Date(Number(msg.messageTimestamp) * 1000),
        };

        await this.autoReplyService.processIncomingMessage(incomingMessage);
      } catch (autoReplyError) {
        this.fastify.log.warn(
          'Failed to process auto reply for incoming message: ' +
          (autoReplyError instanceof Error ? autoReplyError.message : String(autoReplyError))
        );
      }
    } catch (error) {
      this.fastify.log.error(
        'Failed to save incoming message:: ' +
        (error instanceof Error ? error.message : String(error))
      );
    }
  }

  private async updateMessageStatus(sessionId: string, update: any) {
    try {
      await db
        .update(message)
        .set({
          status: this.mapBaileysStatus(update.update.status),
          updatedAt: new Date(),
        })
        .where(eq(message.externalId, update.key.id));
    } catch (error) {
      this.fastify.log.error(
        'Failed to update message status:: ' +
        (error instanceof Error ? error.message : String(error))
      );
    }
  }

  private async handleContactsUpsert(
    sessionContext: { sessionId: string; organizationId: string; sessionKey: string },
    contacts: Contact[]
  ) {
    const { sessionId, organizationId } = sessionContext;

    try {
      this.fastify.log.info(`Processing ${contacts.length} contacts from WhatsApp`);

      for (const waContact of contacts) {
        try {
          const phoneNumber = waContact.id.split('@')[0];

          // Skip if not a valid phone number
          if (!phoneNumber.match(/^\d+$/)) {
            continue;
          }

          // Check if contact already exists
          const [existingContact] = await db
            .select()
            .from(contact)
            .where(and(eq(contact.organizationId, organizationId), eq(contact.phone, phoneNumber)))
            .limit(1);

          if (existingContact) {
            // Update existing contact
            const currentTags = existingContact.tags || [];
            const newTags = currentTags.includes('whatsapp-sync')
              ? currentTags
              : [...currentTags, 'whatsapp-sync'];

            await db
              .update(contact)
              .set({
                name: waContact.name || waContact.notify || waContact.verifiedName || '-',
                tags: newTags,
                updatedAt: new Date(),
              })
              .where(eq(contact.id, existingContact.id));

            this.fastify.log.info(`Updated contact: ${phoneNumber}`);
          } else {
            // Create new contact
            const newContact = {
              id: createId(),
              organizationId,
              name: waContact.name || waContact.notify || waContact.verifiedName || '-',
              phone: phoneNumber,
              email: null,
              groups: [],
              tags: ['whatsapp-sync'],
              notes: `Auto-synced from WhatsApp session ${sessionId}`,
              createdAt: new Date(),
              updatedAt: new Date(),
            };

            await db.insert(contact).values(newContact);
            this.fastify.log.info(`Created contact: ${phoneNumber} (${newContact.name})`);
          }
        } catch (contactError) {
          this.fastify.log.warn(`Failed to process contact ${waContact.id}:`, contactError);
        }
      }

      this.fastify.log.info(`Successfully processed ${contacts.length} WhatsApp contacts`);
    } catch (error) {
      this.fastify.log.error(`Error handling contacts upsert for session ${sessionId}:`, error);
    }
  }

  private async handleGroupsUpsert(
    sessionContext: { sessionId: string; organizationId: string; sessionKey: string },
    groups: GroupMetadata[]
  ) {
    const { sessionId, organizationId } = sessionContext;

    try {
      this.fastify.log.info(`Processing ${groups.length} groups from WhatsApp`);

      for (const waGroup of groups) {
        try {
          // Skip if not a group
          if (!waGroup.id.includes('@g.us')) {
            continue;
          }

          // Check if group already exists
          const [existingGroup] = await db
            .select()
            .from(contactGroup)
            .where(
              and(
                eq(contactGroup.organizationId, organizationId),
                eq(contactGroup.whatsappGroupId, waGroup.id)
              )
            )
            .limit(1);

          if (existingGroup) {
            // Update existing group
            await db
              .update(contactGroup)
              .set({
                name: waGroup.subject || 'Unknown Group',
                description: waGroup.desc || '',
                participantCount: waGroup.participants?.length || 0,
                updatedAt: new Date(),
              })
              .where(eq(contactGroup.id, existingGroup.id));

            this.fastify.log.info(`Updated group: ${waGroup.subject}`);
          } else {
            // Create new group
            const newGroup = {
              id: createId(),
              organizationId,
              name: waGroup.subject || 'Unknown Group',
              description: waGroup.desc || '',
              whatsappGroupId: waGroup.id,
              participantCount: waGroup.participants?.length || 0,
              createdAt: new Date(),
              updatedAt: new Date(),
            };

            await db.insert(contactGroup).values(newGroup);
            this.fastify.log.info(
              `Created group: ${waGroup.subject} with ${waGroup.participants?.length || 0} participants`
            );
          }

          // Sync group participants as contacts
          if (waGroup.participants) {
            for (const participant of waGroup.participants) {
              try {
                const phoneNumber = participant.id.split('@')[0];

                if (!phoneNumber.match(/^\d+$/)) {
                  continue;
                }

                // Check if participant contact exists
                const [existingContact] = await db
                  .select()
                  .from(contact)
                  .where(
                    and(eq(contact.organizationId, organizationId), eq(contact.phone, phoneNumber))
                  )
                  .limit(1);

                if (existingContact) {
                  // Add group to existing contact's groups
                  const currentGroups = existingContact.groups || [];
                  const currentTags = existingContact.tags || [];
                  const groupName = waGroup.subject || 'Unknown Group';
                  const groupChanged = !currentGroups.includes(groupName);
                  const needsWhatsappGroupTag = !currentTags.includes('whatsapp-group');

                  if (groupChanged || needsWhatsappGroupTag) {
                    const newGroups = groupChanged ? [...currentGroups, groupName] : currentGroups;
                    const newTags = needsWhatsappGroupTag
                      ? [...currentTags, 'whatsapp-group']
                      : currentTags;

                    await db
                      .update(contact)
                      .set({
                        groups: newGroups,
                        tags: newTags,
                        updatedAt: new Date(),
                      })
                      .where(eq(contact.id, existingContact.id));
                  }
                } else {
                  // Create new contact from group participant
                  const newContact = {
                    id: createId(),
                    organizationId,
                    name: participant.notify || participant.verifiedName || phoneNumber,
                    phone: phoneNumber,
                    email: null,
                    groups: [waGroup.subject || 'Unknown Group'],
                    tags: ['whatsapp-group'],
                    notes: `Auto-synced from WhatsApp group: ${waGroup.subject}`,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                  };

                  await db.insert(contact).values(newContact);
                }
              } catch (participantError) {
                this.fastify.log.warn(
                  `Failed to process participant ${participant.id}:`,
                  participantError
                );
              }
            }
          }
        } catch (groupError) {
          this.fastify.log.warn(`Failed to process group ${waGroup.id}:`, groupError);
        }
      }

      this.fastify.log.info(`Successfully processed ${groups.length} WhatsApp groups`);
    } catch (error) {
      this.fastify.log.error(error, `Error handling groups upsert for session ${sessionId}:`);
    }
  }

  private getMessageType(msg: WAMessage): string {
    if (msg.message?.conversation || msg.message?.extendedTextMessage) return 'text';
    if (msg.message?.imageMessage) return 'image';
    if (msg.message?.videoMessage) return 'video';
    if (msg.message?.audioMessage) return 'audio';
    if (msg.message?.documentMessage) return 'document';
    return 'unknown';
  }

  private mapBaileysStatus(status: number): string {
    switch (status) {
      case 0:
        return 'pending';
      case 1:
        return 'sent';
      case 2:
        return 'delivered';
      case 3:
        return 'read';
      default:
        return 'unknown';
    }
  }

  private async saveSessionToDb(session: BaileysSession) {
    try {
      const encryptedSessionBlob = session.socket
        ? encryptData(JSON.stringify(session.socket.user || {}))
        : null;

      // Log the values we're trying to save
      console.log('Attempting to save session to DB:', {
        sessionId: session.id,
        organizationId: session.organizationId,
        status: session.status,
        phoneNumber: session.phoneNumber,
        hasSessionBlob: !!encryptedSessionBlob,
        hasQrCode: !!session.qrCode,
        lastActive: session.lastActive,
      });

      // Try to update first, then insert if not exists
      const [existing] = await db
        .select()
        .from(whatsappSession)
        .where(
          and(
            eq(whatsappSession.id, session.id),
            eq(whatsappSession.organizationId, session.organizationId)
          )
        )
        .limit(1);

      console.log('Existing session found:', !!existing);

      if (existing) {
        console.log('Updating existing session...');
        const result = await db
          .update(whatsappSession)
          .set({
            status: session.status,
            phoneNumber: session.phoneNumber,
            profileName: session.profileName,
            profilePhoto: session.profilePhoto,
            sessionBlob: encryptedSessionBlob,
            qrCode: session.qrCode,
            lastActive: session.lastActive,
            alwaysShowOnline: session.alwaysShowOnline ?? true,
            autoRejectCalls: session.autoRejectCalls ?? false,
            antiBanSubscribe: session.antiBanSubscribe ?? false,
            antiBanStrictMode: session.antiBanStrictMode ?? false,
            webhookUrl: session.webhookUrl,
            webhookMethod: session.webhookMethod ?? 'POST',
            manuallyDisconnected: session.manuallyDisconnected ?? false,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(whatsappSession.id, session.id),
              eq(whatsappSession.organizationId, session.organizationId)
            )
          );
        console.log('Update result:', result);
      } else {
        console.log('Inserting new session...');
        const insertData = {
          id: session.id,
          organizationId: session.organizationId,
          name: `Session ${session.id}`,
          phoneNumber: session.phoneNumber,
          profileName: session.profileName,
          profilePhoto: session.profilePhoto,
          status: session.status,
          sessionBlob: encryptedSessionBlob,
          qrCode: session.qrCode,
          lastActive: session.lastActive,
          alwaysShowOnline: session.alwaysShowOnline ?? true,
          autoRejectCalls: session.autoRejectCalls ?? false,
          antiBanSubscribe: session.antiBanSubscribe ?? false,
          antiBanStrictMode: session.antiBanStrictMode ?? false,
          webhookUrl: session.webhookUrl,
          webhookMethod: session.webhookMethod ?? 'POST',
          manuallyDisconnected: session.manuallyDisconnected ?? false,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        console.log('Insert data:', insertData);

        const result = await db.insert(whatsappSession).values(insertData);
        console.log('Insert result:', result);
      }

      console.log('Session saved successfully to database');
    } catch (error) {
      this.fastify.log.error(
        'Failed to save session to database:: ' +
        ({
          error: error instanceof Error ? error.message : error,
          stack: error instanceof Error ? error.stack : undefined,
          sessionId: session.id,
          organizationId: session.organizationId,
          status: session.status,
          fullError: error,
        } instanceof Error
          ? {
            error: error instanceof Error ? error.message : error,
            stack: error instanceof Error ? error.stack : undefined,
            sessionId: session.id,
            organizationId: session.organizationId,
            status: session.status,
            fullError: error,
          }.message
          : String({
            error: error instanceof Error ? error.message : error,
            stack: error instanceof Error ? error.stack : undefined,
            sessionId: session.id,
            organizationId: session.organizationId,
            status: session.status,
            fullError: error,
          }))
      );

      // Log the full error details to understand what's failing
      console.error('Database save error details:', error);
      console.error('Error name:', error instanceof Error ? error.name : 'unknown');
      console.error('Error cause:', error instanceof Error ? error.cause : 'none');

      // Don't re-throw to prevent breaking the WhatsApp connection flow
    }

    // Invalidate cache after database update
    await this.invalidateSessionCache(session.id, session.organizationId);
  }

  /**
   * Cache session metadata in Redis
   * TTL: 300 seconds (5 minutes)
   */
  private async cacheSession(session: any): Promise<void> {
    const cacheKey = `session:${session.organizationId}:${session.id}`;
    const cacheData = {
      id: session.id,
      organizationId: session.organizationId,
      status: session.status,
      phoneNumber: session.phoneNumber,
      profileName: session.profileName,
      profilePhoto: session.profilePhoto,
      qrCode: session.qrCode,
      lastActive: session.lastActive,
      createdAt: session.createdAt,
      alwaysShowOnline: session.alwaysShowOnline,
      autoRejectCalls: session.autoRejectCalls,
      antiBanSubscribe: session.antiBanSubscribe,
      antiBanStrictMode: session.antiBanStrictMode,
      webhookUrl: session.webhookUrl,
      webhookMethod: session.webhookMethod,
      manuallyDisconnected: session.manuallyDisconnected,
    };

    try {
      await this.fastify.redis.setex(cacheKey, 300, JSON.stringify(cacheData));
    } catch (error) {
      this.fastify.log.warn(`Failed to cache session ${session.id}:`, error);
    }
  }

  /**
   * Invalidate session cache in Redis
   */
  private async invalidateSessionCache(sessionId: string, organizationId: string): Promise<void> {
    const cacheKey = `session:${organizationId}:${sessionId}`;
    try {
      await this.fastify.redis.del(cacheKey);
    } catch (error) {
      this.fastify.log.warn(`Failed to invalidate cache for session ${sessionId}:`, error);
    }
  }

  private async restoreSession(dbSession: any) {
    try {
      // Restore the session from database-backed auth state
      await this.createSession(dbSession.id, dbSession.organizationId);
    } catch (error) {
      throw new Error(
        `Cannot restore session: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async publishEvent(sessionId: string, event: string, data: any) {
    try {
      const eventPayload = { event, data, timestamp: new Date().toISOString() };
      const channel = `whatsapp:session:${sessionId}`;

      this.fastify.log.info(`Publishing Redis event to channel ${channel}:`, eventPayload);

      await this.fastify.redis.publish(channel, JSON.stringify(eventPayload));

      this.fastify.log.info(`Successfully published Redis event to channel ${channel}`);
    } catch (error) {
      this.fastify.log.error(
        'Failed to publish Redis event:: ' +
        (error instanceof Error ? error.message : String(error))
      );
    }
  }

  async saveOutgoingMessage(
    organizationId: string,
    sessionId: string,
    messageId: string,
    to: string,
    content: string,
    result: any
  ) {
    try {
      await db.insert(message).values({
        id: messageId,
        organizationId,
        sessionId,
        externalId: result.key?.id,
        direction: 'outbound',
        from: sessionId,
        to,
        messageType: 'text',
        content: { text: content },
        status: 'sent',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Publish message event
      await this.publishEvent(sessionId, 'message.sent', {
        messageId,
        to,
        content: { text: content },
      });
    } catch (error) {
      this.fastify.log.error(
        'Failed to save outgoing message:: ' +
        (error instanceof Error ? error.message : String(error))
      );
    }
  }

  async updateSessionSettings(
    sessionId: string,
    organizationId: string,
    settings: {
      alwaysShowOnline?: boolean;
      autoRejectCalls?: boolean;
      antiBanSubscribe?: boolean;
      antiBanStrictMode?: boolean;
      webhookUrl?: string;
      webhookMethod?: string;
    }
  ): Promise<void> {
    // Update in-memory session if exists
    const sessionKey = `${organizationId}:${sessionId}`;
    const session = this.sessions.get(sessionKey);
    if (session) {
      Object.assign(session, settings);
    }

    // Update database
    await db
      .update(whatsappSession)
      .set({
        ...settings,
        updatedAt: new Date(),
      })
      .where(
        and(eq(whatsappSession.id, sessionId), eq(whatsappSession.organizationId, organizationId))
      );

    this.fastify.log.info(`Updated settings for session ${sessionId}:`, settings);
  }

  async reconnectSession(sessionId: string, organizationId: string): Promise<void> {
    this.fastify.log.info(`Starting reconnection for session ${sessionId}`);

    // Clear manually disconnected flag and attempt reconnection
    await db
      .update(whatsappSession)
      .set({
        manuallyDisconnected: false,
        status: 'connecting',
        updatedAt: new Date(),
      })
      .where(
        and(eq(whatsappSession.id, sessionId), eq(whatsappSession.organizationId, organizationId))
      );

    // Publish connecting event immediately
    await this.publishEvent(sessionId, 'connecting', {
      reason: 'manual_reconnect',
      status: 'connecting',
      manuallyDisconnected: false,
    });

    const sessionKey = `${organizationId}:${sessionId}`;

    // Remove existing session from memory if it exists
    if (this.sessions.has(sessionKey)) {
      const existingSession = this.sessions.get(sessionKey);
      if (existingSession?.socket) {
        existingSession.socket.end(undefined);
      }
      this.sessions.delete(sessionKey);
    }

    // Try to create new session
    try {
      await this.createSession(sessionId, organizationId);
      this.fastify.log.info(`Successfully initiated reconnection for session ${sessionId}`);
    } catch (error) {
      this.fastify.log.error(`Failed to reconnect session ${sessionId}:`, error);

      // Update status to failed and publish event
      await db
        .update(whatsappSession)
        .set({
          status: 'disconnected',
          updatedAt: new Date(),
        })
        .where(
          and(eq(whatsappSession.id, sessionId), eq(whatsappSession.organizationId, organizationId))
        );

      await this.publishEvent(sessionId, 'disconnected', { reason: 'reconnect_failed' });
      throw error;
    }
  }

  async deleteSession(sessionId: string, organizationId: string): Promise<void> {
    try {
      this.fastify.log.info(
        `Starting deletion of session ${sessionId} for organization ${organizationId}`
      );

      const sessionKey = `${organizationId}:${sessionId}`;
      const session = this.sessions.get(sessionKey);

      this.fastify.log.info(`Session found in memory: ${!!session}`);

      // Disconnect if connected
      if (session?.socket) {
        try {
          this.fastify.log.info(`Closing socket for session ${sessionId}`);
          session.socket.end(undefined);
        } catch (error) {
          this.fastify.log.error(`Failed to close socket for session ${sessionId}:`, error);
        }
      }

      // Remove from memory
      this.sessions.delete(sessionKey);
      this.fastify.log.info(`Removed session ${sessionId} from memory`);

      // Delete related messages first (due to foreign key constraints)
      this.fastify.log.info(`Deleting messages for session ${sessionId}`);
      await db
        .delete(message)
        .where(and(eq(message.sessionId, sessionId), eq(message.organizationId, organizationId)));

      // Delete from database
      this.fastify.log.info(`Deleting session ${sessionId} from database`);
      const deleteResult = await db
        .delete(whatsappSession)
        .where(
          and(eq(whatsappSession.id, sessionId), eq(whatsappSession.organizationId, organizationId))
        );

      this.fastify.log.info(`Database deletion result for session ${sessionId}:`, deleteResult);

      // Delete auth directories if they exist
      // Delete auth state from database
      try {
        await db.delete(baileysAuthState).where(eq(baileysAuthState.sessionId, sessionId));
        this.fastify.log.info(`Deleted auth state from database for session ${sessionId}`);
      } catch (error) {
        this.fastify.log.warn(`Failed to delete auth state for session ${sessionId}:`, error);
      }

      // Publish deletion event
      await this.publishEvent(sessionId, 'deleted', { organizationId });

      // Ingest account.deleted event for usage tracking
      try {
        await this.ingestAccountDeletedEvent(organizationId, {
          sessionId,
          accountType: 'whatsapp',
          deletedAt: new Date().toISOString(),
        });
        this.fastify.log.info(`Ingested account.deleted event for session ${sessionId}`);
      } catch (ingestError) {
        this.fastify.log.warn(
          `Failed to ingest account.deleted event for session ${sessionId}:`,
          ingestError
        );
      }

      this.fastify.log.info(
        `Session ${sessionId} deleted successfully for organization ${organizationId}`
      );
    } catch (error) {
      this.fastify.log.error(`Failed to delete session ${sessionId}:`, {
        error: error instanceof Error ? error.message : error,
        stack: error instanceof Error ? error.stack : undefined,
        sessionId,
        organizationId,
      });
      throw error;
    }
  }

  startWebhookRetryTask() {
    this.webhookService.startRetryTask();
  }

  // Clean up on app shutdown
  async cleanup() {
    this.fastify.log.info('Cleaning up Baileys sessions...');

    // Cleanup webhook service
    await this.webhookService.cleanup();

    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.socket) {
        try {
          session.socket.end(undefined);
        } catch (error) {
          this.fastify.log.error(`Failed to close session ${sessionId}:`, error);
        }
      }
    }

    this.sessions.clear();
  }

  /**
   * Ingest account.created event for usage tracking
   */
  private async ingestAccountCreatedEvent(organizationId: string, eventData: any) {
    try {
      this.fastify.log.info(
        `🔄 Starting ingestion for organization ${organizationId} with data:`,
        eventData
      );

      // Use the internal ingestion controller directly instead of HTTP
      const { ingestEvent } = await import('../controllers/benefitsIngestionController');

      const mockRequest = {
        body: {
          customerId: organizationId,
          eventName: 'account.created',
          eventData,
          timestamp: new Date().toISOString(),
        },
      } as any;

      this.fastify.log.info(`📤 Calling ingestEvent with request:`, mockRequest.body);

      const mockReply = {
        status: (code: number) => ({
          send: (data: any) => {
            this.fastify.log.info(`📥 Ingestion reply with status ${code}:`, data);
            if (code !== 200) {
              throw new Error(`Ingestion failed: ${data.error || 'Unknown error'}`);
            }
            return data;
          },
        }),
        send: (data: any) => {
          this.fastify.log.info(`📥 Ingestion reply (success):`, data);
          return data;
        },
      } as any;

      const result = await ingestEvent(mockRequest, mockReply);
      this.fastify.log.info(`✅ Successfully ingested account.created event:`, result);
      return result;
    } catch (error) {
      this.fastify.log.error(`❌ Failed to ingest account.created event:`, error);
      throw error;
    }
  }

  /**
   * Remove ingestion for account deletion
   */
  private async ingestAccountDeletedEvent(organizationId: string, eventData: any) {
    try {
      // Use the internal ingestion controller directly instead of HTTP
      const { ingestEvent } = await import('../controllers/benefitsIngestionController');

      const mockRequest = {
        body: {
          customerId: organizationId,
          eventName: 'account.deleted',
          eventData,
          timestamp: new Date().toISOString(),
        },
      } as any;

      const mockReply = {
        status: (code: number) => ({
          send: (data: any) => {
            if (code !== 200) {
              throw new Error(`Ingestion failed: ${data.error || 'Unknown error'}`);
            }
            return data;
          },
        }),
        send: (data: any) => data,
      } as any;

      const result = await ingestEvent(mockRequest, mockReply);
      this.fastify.log.info(`Successfully ingested account.deleted event:`, result);
      return result;
    } catch (error) {
      this.fastify.log.error(`Failed to ingest account.deleted event:`, error);
      throw error;
    }
  }

  /**
   * Generate a pairing code for a session
   * User can use this code instead of scanning QR code
   */
  async generatePairingCode(sessionId: string, organizationId: string): Promise<string> {
    const sessionKey = `${organizationId}:${sessionId}`;
    const session = this.sessions.get(sessionKey);

    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    if (!session.socket) {
      throw new Error(`Socket not initialized for session ${sessionId}`);
    }

    try {
      this.fastify.log.info(`Requesting pairing code for session ${sessionId}`);

      // For v7, wait a moment to ensure socket is fully initialized
      await new Promise(resolve => setTimeout(resolve, 500));

      // Request pairing code from socket
      const pairingCode = await (session.socket as any).requestPairingCode();

      if (!pairingCode) {
        throw new Error('No pairing code returned from socket');
      }

      this.fastify.log.info(
        `Successfully generated pairing code for session ${sessionId}: ${pairingCode}`
      );

      // Store the pairing code in the session
      session.pairingCode = pairingCode;

      // Save to database
      await db
        .update(whatsappSession)
        .set({
          pairingCode,
          updatedAt: new Date(),
        })
        .where(
          and(eq(whatsappSession.id, sessionId), eq(whatsappSession.organizationId, organizationId))
        );

      return pairingCode;
    } catch (error) {
      this.fastify.log.error(`Failed to generate pairing code for session ${sessionId}:`, error);
      throw error;
    }
  }
}
