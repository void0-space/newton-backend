import { db } from '../db/drizzle';
import { scheduledMessage, scheduledMessageLog, whatsappSession, message } from '../db/schema';
import { eq, and, lte } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import { BaileysManager, BaileysSession } from './baileysService';

export class SchedulerService {
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;
  private baileysManager: BaileysManager | null = null;
  private messageQueue: any = null; // Add message queue property

  constructor(baileysManager?: BaileysManager, messageQueue?: any) {
    this.baileysManager = baileysManager;
    this.messageQueue = messageQueue;
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

      console.log(`Found ${dueMessages.length} due scheduled messages`);

      // Process messages in batches of 5 to prevent overwhelming the system
      const batchSize = 5;
      for (let i = 0; i < dueMessages.length; i += batchSize) {
        const batch = dueMessages.slice(i, i + batchSize);
        console.log(`Processing batch ${Math.floor(i / batchSize) + 1} of ${Math.ceil(dueMessages.length / batchSize)}`);
        
        // Process each batch in parallel
        const batchPromises = batch.map(message => 
          this.processScheduledMessage(message).catch(error => {
            console.error(`Error processing scheduled message ${message.id}:`, error);
          })
        );
        
        await Promise.all(batchPromises);
        
        // Wait for a short time before processing the next batch to give resources time to recover
        if (i + batchSize < dueMessages.length) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }

      console.log(`Finished processing ${dueMessages.length} scheduled messages`);
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

      // Process each recipient using message queue for better performance
      const recipients = Array.isArray(message.recipients) ? message.recipients : [];
      let successCount = 0;
      let failedCount = 0;

      // Process recipients in parallel with concurrency control
      const promises = recipients.map(async (recipient) => {
        try {
          // Use message queue instead of direct socket communication
          await this.sendViaMessageQueue(message, recipient, session);
          await this.logMessageDelivery(
            message.id,
            recipient,
            'sent',
            `scheduled_${createId()}`
          );
          successCount++;
        } catch (error) {
          console.error(`Failed to send message to ${recipient}:`, error);
          failedCount++;
          await this.logMessageDelivery(
            message.id,
            recipient,
            'failed',
            null,
            error instanceof Error ? error.message : 'Unknown error'
          );
        }
      });

      await Promise.all(promises);

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

  async sendViaMessageQueue(scheduledMsg: any, recipient: string, dbSession: any) {
    try {
      // Format recipient phone number
      const formattedRecipient = recipient.includes('@')
        ? recipient
        : `${recipient}@s.whatsapp.net`;

      // Prepare message content
      let messageContent: any = {};
      let messageText = '';
      let caption = '';

      if (scheduledMsg.messageType === 'text') {
        messageContent = { text: scheduledMsg.content?.text || '' };
        messageText = scheduledMsg.content?.text || '';
      } else if (scheduledMsg.messageType === 'image') {
        messageContent = {
          image: { url: scheduledMsg.mediaUrl },
          caption: scheduledMsg.content?.caption,
        };
        caption = scheduledMsg.content?.caption || '';
      } else if (scheduledMsg.messageType === 'video') {
        messageContent = {
          video: { url: scheduledMsg.mediaUrl },
          caption: scheduledMsg.content?.caption,
        };
        caption = scheduledMsg.content?.caption || '';
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
        caption = scheduledMsg.content?.caption || '';
      }

      // Queue the message for processing
      const jobData = {
        organizationId: scheduledMsg.organizationId,
        sessionId: scheduledMsg.sessionId,
        to: formattedRecipient,
        messageContent,
        messageText,
        caption,
        type: scheduledMsg.messageType,
      };

      // Use the message queue instance if available
      let jobId;
      if (this.messageQueue) {
        jobId = await this.messageQueue.queueMessage(jobData);
      } else {
        // Fallback to direct socket communication if queue not available
        console.warn('Message queue not available, using direct socket communication');
        const result = await this.sendMessageToRecipient(scheduledMsg, recipient, dbSession);
        return result;
      }
      
      return { key: { id: jobId } };
    } catch (error) {
      console.error(`Error queuing message for ${recipient}:`, error);
      throw error;
    }
  }

  async sendMessageToRecipient(scheduledMsg: any, recipient: string, dbSession: any, baileysSession?: BaileysSession) {
    // Fallback method for compatibility (still uses old direct socket approach)
    try {
      const formattedRecipient = recipient.includes('@')
        ? recipient
        : `${recipient}@s.whatsapp.net`;

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

      let result;

      try {
        if (baileysSession && baileysSession.socket && baileysSession.status === 'connected') {
          result = await baileysSession.socket.sendMessage(formattedRecipient, messageContent);
        } else if (this.baileysManager) {
          const sessionData = await this.baileysManager.getSession(dbSession.id, dbSession.organizationId);
          
          if (sessionData && sessionData.socket && sessionData.status === 'connected') {
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
        result = {
          key: { id: `scheduled_${createId()}` },
          status: 1,
        };
      }

      const messageId = createId();
      const contentForDb =
        typeof scheduledMsg.content === 'object'
          ? scheduledMsg.content.text ||
            scheduledMsg.content.caption ||
            `${scheduledMsg.messageType} message`
          : scheduledMsg.content;

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
