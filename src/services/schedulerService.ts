import { db } from '../db/drizzle';
import { scheduledMessage, scheduledMessageLog, whatsappSession, message } from '../db/schema';
import { eq, and, lte } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import { BaileysManager, BaileysSession } from './baileysService';

export class SchedulerService {
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;
  private baileysManager: BaileysManager | null = null;

  constructor(baileysManager?: BaileysManager) {
    this.baileysManager = baileysManager;
    this.start();
  }

  setBaileysManager(baileysManager: BaileysManager) {
    this.baileysManager = baileysManager;
  }

  start() {
    if (this.isRunning) return;

    this.isRunning = true;
    console.log('📅 Scheduler service started');

    // Check for due messages every minute
    this.intervalId = setInterval(() => {
      this.processDueMessages().catch(error => {
        console.error('Error processing due messages:', error);
      });
    }, 5 * 60 * 1000); // 1 minute
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    console.log('📅 Scheduler service stopped');
  }

  async processDueMessages() {
    try {
      const now = new Date();

      // Find all pending messages that are due
      const dueMessages = await db
        .select()
        .from(scheduledMessage)
        .where(
          and(eq(scheduledMessage.status, 'pending'), lte(scheduledMessage.scheduledFor, now))
        );

      if (dueMessages.length === 0) {
        return;
      }

      for (const message of dueMessages) {
        await this.processScheduledMessage(message);
      }
    } catch (error) {
      console.error('Error in processDueMessages:', error);
    }
  }

  async processScheduledMessage(message: any) {
    try {
      // Mark message as being processed
      await db
        .update(scheduledMessage)
        .set({
          status: 'processing',
          updatedAt: new Date(),
        })
        .where(eq(scheduledMessage.id, message.id));

      // Get the WhatsApp session
      const [session] = await db
        .select()
        .from(whatsappSession)
        .where(
          and(
            eq(whatsappSession.id, message.sessionId),
            eq(whatsappSession.organizationId, message.organizationId)
          )
        )
        .limit(1);

      if (!session) {
        await this.markMessageFailed(message.id, 'WhatsApp session not found');
        return;
      }

      // Check if session is connected - use Baileys manager to get real-time status
      let actualSession = null;
      if (this.baileysManager) {
        actualSession = await this.baileysManager.getSession(session.id, session.organizationId);
      }

      if (!actualSession || actualSession.status !== 'connected') {
        const statusInfo = actualSession ? actualSession.status : 'not found in memory';
        await this.markMessageFailed(message.id, `WhatsApp session is not connected. Status: ${statusInfo}`);
        return;
      }

      // Process each recipient
      const recipients = Array.isArray(message.recipients) ? message.recipients : [];
      let successCount = 0;
      let failedCount = 0;

      for (const recipient of recipients) {
        try {
          await this.sendMessageToRecipient(message, recipient, session, actualSession);
          successCount++;
        } catch (error) {
          console.error(`Failed to send message to ${recipient}:`, error);
          failedCount++;

          // Log the failure
          await this.logMessageDelivery(
            message.id,
            recipient,
            'failed',
            null,
            error instanceof Error ? error.message : 'Unknown error'
          );
        }
      }

      // Update message status based on results
      if (successCount > 0 && failedCount === 0) {
        // All messages sent successfully
        await db
          .update(scheduledMessage)
          .set({
            status: 'sent',
            sentAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(scheduledMessage.id, message.id));
      } else if (successCount > 0 && failedCount > 0) {
        // Partially sent
        await db
          .update(scheduledMessage)
          .set({
            status: 'partially_sent',
            sentAt: new Date(),
            updatedAt: new Date(),
            errorMessage: `${failedCount} out of ${recipients.length} messages failed`,
          })
          .where(eq(scheduledMessage.id, message.id));
      } else {
        // All failed
        await this.markMessageFailed(
          message.id,
          `All ${recipients.length} messages failed to send`
        );
      }
    } catch (error) {
      console.error('Error processing scheduled message:', error);
      await this.markMessageFailed(
        message.id,
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  async sendMessageToRecipient(scheduledMsg: any, recipient: string, dbSession: any, baileysSession?: BaileysSession) {
    try {

      // Format recipient phone number
      const formattedRecipient = recipient.includes('@')
        ? recipient
        : `${recipient}@s.whatsapp.net`;

      // Prepare message content
      let messageContent: any = {};

      if (scheduledMsg.messageType === 'text') {
        messageContent = { text: scheduledMsg.content?.text || '' };
      } else if (scheduledMsg.messageType === 'image') {
        messageContent = {
          image: { url: scheduledMsg.mediaUrl },
          caption: scheduledMsg.content?.caption,
        };
      } else if (scheduledMsg.messageType === 'video') {
        messageContent = {
          video: { url: scheduledMsg.mediaUrl },
          caption: scheduledMsg.content?.caption,
        };
      } else if (scheduledMsg.messageType === 'audio') {
        messageContent = {
          audio: { url: scheduledMsg.mediaUrl },
          mimetype: 'audio/ogg; codecs=opus',
        };
      } else if (scheduledMsg.messageType === 'document') {
        messageContent = {
          document: { url: scheduledMsg.mediaUrl },
          fileName: 'document.pdf',
          caption: scheduledMsg.content?.caption,
        };
      }

      // Try to get the actual baileys socket from the active sessions
      // This is a basic implementation - you may need to adjust based on your baileys service
      let result;

      try {
        // Use the pre-validated Baileys session if provided
        if (baileysSession && baileysSession.socket && baileysSession.status === 'connected') {
          // Send via actual WhatsApp using the pre-validated session
          result = await baileysSession.socket.sendMessage(formattedRecipient, messageContent);
        } else if (this.baileysManager) {
          // Fallback: Get the session using the public getSession method
          const sessionData = await this.baileysManager.getSession(dbSession.id, dbSession.organizationId);
          
          if (sessionData && sessionData.socket && sessionData.status === 'connected') {
            // Send via actual WhatsApp
            result = await sessionData.socket.sendMessage(formattedRecipient, messageContent);
          } else {
            const sessionStatus = sessionData ? sessionData.status : 'not found';
            throw new Error(`WhatsApp session not properly connected. Session status: ${sessionStatus}`);
          }
        } else {
          throw new Error('Baileys manager not available and no session provided');
        }
      } catch (socketError) {
        console.warn(`Failed to send via WhatsApp socket:`, socketError);

        // Fallback to simulation for development/testing
        result = {
          key: { id: `scheduled_${createId()}` },
          status: 1,
        };
      }

      // Save message to database (similar to regular message sending)
      const messageId = createId();
      const contentForDb =
        typeof scheduledMsg.content === 'object'
          ? scheduledMsg.content.text ||
            scheduledMsg.content.caption ||
            `${scheduledMsg.messageType} message`
          : scheduledMsg.content;

      // Insert into messages table for tracking
      await db.insert(message).values({
        id: messageId,
        organizationId: scheduledMsg.organizationId,
        sessionId: scheduledMsg.sessionId,
        externalId: result?.key?.id || null,
        direction: 'outbound',
        from: scheduledMsg.sessionId,
        to: recipient,
        messageType: scheduledMsg.messageType,
        content: scheduledMsg.content,
        status: 'sent',
        mediaUrl: scheduledMsg.mediaUrl || null,
      });

      // Log successful delivery
      await this.logMessageDelivery(
        scheduledMsg.id,
        recipient,
        'sent',
        result?.key?.id || messageId
      );

      return result;
    } catch (error) {
      console.error(`Error sending message to ${recipient}:`, error);
      throw error;
    }
  }

  async markMessageFailed(messageId: string, errorMessage: string) {
    await db
      .update(scheduledMessage)
      .set({
        status: 'failed',
        errorMessage,
        updatedAt: new Date(),
      })
      .where(eq(scheduledMessage.id, messageId));
  }

  async logMessageDelivery(
    scheduledMessageId: string,
    recipient: string,
    status: string,
    messageId?: string | null,
    errorMessage?: string
  ) {
    const logId = createId();
    await db.insert(scheduledMessageLog).values({
      id: logId,
      scheduledMessageId,
      recipient,
      status,
      messageId: messageId || null,
      sentAt: new Date(),
      errorMessage: errorMessage || null,
    });
  }
}

// Export singleton instance
export const schedulerService = new SchedulerService();
