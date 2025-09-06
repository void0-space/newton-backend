import { db } from '../db/drizzle';
import { autoReply, autoReplyUsage, autoReplyLog } from '../db/schema';
import { eq, and, sql, gte, lt } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import { BaileysManager } from './baileysService';

export interface IncomingMessage {
  messageId: string;
  from: string;
  text: string;
  timestamp: Date;
  whatsappAccountId: string;
  organizationId: string;
  contactName?: string;
}

export class AutoReplyService {
  private baileysManager?: BaileysManager;

  constructor() {}

  setBaileysManager(baileysManager: BaileysManager) {
    this.baileysManager = baileysManager;
  }

  async processIncomingMessage(message: IncomingMessage): Promise<void> {
    try {
      console.log(`Processing auto reply for message from ${message.from}`);

      // Get enabled auto reply rules for this WhatsApp account, ordered by priority
      const rules = await db
        .select()
        .from(autoReply)
        .where(
          and(
            eq(autoReply.whatsappAccountId, message.whatsappAccountId),
            eq(autoReply.organizationId, message.organizationId),
            eq(autoReply.isEnabled, true)
          )
        )
        .orderBy(sql`${autoReply.priority} DESC`, sql`${autoReply.createdAt} ASC`);

      if (rules.length === 0) {
        console.log('No auto reply rules found for this account');
        return;
      }

      // Process rules in priority order
      for (const rule of rules) {
        const startTime = Date.now();

        try {
          // Check if this rule matches the message
          const matchResult = await this.checkRuleMatch(rule, message);

          if (!matchResult.matches) {
            console.log(`Rule ${rule.name} did not match`);
            continue;
          }

          console.log(`Rule ${rule.name} matched with: ${matchResult.trigger}`);

          // Check rate limits
          const rateLimitPassed = await this.checkRateLimit(rule, message.from);

          if (!rateLimitPassed) {
            await this.logAutoReply(
              rule,
              message,
              matchResult.trigger,
              'skipped',
              'Rate limit exceeded',
              startTime
            );
            console.log(`Rule ${rule.name} skipped due to rate limit`);
            continue;
          }

          // Check business hours if applicable
          const businessHoursPassed = this.checkBusinessHours(rule);

          if (!businessHoursPassed) {
            await this.logAutoReply(
              rule,
              message,
              matchResult.trigger,
              'skipped',
              'Outside business hours',
              startTime
            );
            console.log(`Rule ${rule.name} skipped due to business hours`);
            continue;
          }

          // Send the auto reply
          const replyResult = await this.sendAutoReply(rule, message, matchResult.trigger);

          if (replyResult.success) {
            // Update usage tracking
            await this.updateUsageTracking(rule, message.from);

            // Update rule statistics
            await this.updateRuleStats(rule.id, true);

            // Log successful reply
            await this.logAutoReply(
              rule,
              message,
              matchResult.trigger,
              'sent',
              undefined,
              startTime,
              replyResult.messageId
            );

            console.log(`Auto reply sent successfully for rule ${rule.name}`);

            // Stop processing after first successful reply (highest priority wins)
            break;
          } else {
            // Log failed reply
            await this.logAutoReply(
              rule,
              message,
              matchResult.trigger,
              'failed',
              replyResult.error,
              startTime
            );

            console.error(`Failed to send auto reply for rule ${rule.name}: ${replyResult.error}`);
          }
        } catch (ruleError) {
          console.error(`Error processing rule ${rule.name}:`, ruleError);
          await this.logAutoReply(
            rule,
            message,
            '',
            'failed',
            ruleError instanceof Error ? ruleError.message : 'Unknown error',
            startTime
          );
        }
      }
    } catch (error) {
      console.error('Error in auto reply service:', error);
    }
  }

  private async checkRuleMatch(
    rule: typeof autoReply.$inferSelect,
    message: IncomingMessage
  ): Promise<{ matches: boolean; trigger: string }> {
    const messageText = message.text.toLowerCase();

    switch (rule.triggerType) {
      case 'all_messages':
        return { matches: true, trigger: 'all_messages' };

      case 'keyword':
        if (rule.keywords && Array.isArray(rule.keywords)) {
          for (const keyword of rule.keywords) {
            const keywordToMatch = rule.caseSensitive ? keyword : keyword.toLowerCase();
            const textToSearch = rule.caseSensitive ? message.text : messageText;

            // Check for whole word match
            const regex = new RegExp(
              `\\b${keywordToMatch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`
            );
            if (regex.test(textToSearch)) {
              return { matches: true, trigger: keyword };
            }
          }
        }
        return { matches: false, trigger: '' };

      case 'contains':
        if (rule.pattern) {
          const patternToMatch = rule.caseSensitive ? rule.pattern : rule.pattern.toLowerCase();
          const textToSearch = rule.caseSensitive ? message.text : messageText;
          return {
            matches: textToSearch.includes(patternToMatch),
            trigger: rule.pattern,
          };
        }
        return { matches: false, trigger: '' };

      case 'exact_match':
        if (rule.pattern) {
          const patternToMatch = rule.caseSensitive ? rule.pattern : rule.pattern.toLowerCase();
          const textToSearch = rule.caseSensitive ? message.text : messageText;
          return {
            matches: textToSearch.trim() === patternToMatch.trim(),
            trigger: rule.pattern,
          };
        }
        return { matches: false, trigger: '' };

      case 'regex':
        if (rule.pattern) {
          try {
            const flags = rule.caseSensitive ? 'g' : 'gi';
            const regex = new RegExp(rule.pattern, flags);
            return {
              matches: regex.test(message.text),
              trigger: rule.pattern,
            };
          } catch (error) {
            console.error('Invalid regex pattern:', rule.pattern);
            return { matches: false, trigger: '' };
          }
        }
        return { matches: false, trigger: '' };

      case 'business_hours':
        return {
          matches: this.checkBusinessHours(rule),
          trigger: 'business_hours',
        };

      case 'after_hours':
        return {
          matches: !this.checkBusinessHours(rule),
          trigger: 'after_hours',
        };

      default:
        return { matches: false, trigger: '' };
    }
  }

  private async checkRateLimit(
    rule: typeof autoReply.$inferSelect,
    contactPhone: string
  ): Promise<boolean> {
    if (!rule.maxRepliesPerContact && !rule.maxRepliesPerHour) {
      return true; // No rate limits configured
    }

    const now = new Date();
    const resetHours = rule.resetInterval || 24;
    const resetTime = new Date(now.getTime() - resetHours * 60 * 60 * 1000);

    // Check per-contact rate limit
    if (rule.maxRepliesPerContact && rule.maxRepliesPerContact > 0) {
      const usage = await db
        .select()
        .from(autoReplyUsage)
        .where(
          and(
            eq(autoReplyUsage.autoReplyId, rule.id),
            eq(autoReplyUsage.contactPhone, contactPhone),
            gte(autoReplyUsage.resetAt, resetTime)
          )
        )
        .limit(1);

      if (usage.length > 0 && usage[0].replyCount >= rule.maxRepliesPerContact) {
        return false;
      }
    }

    // Check global hourly rate limit
    if (rule.maxRepliesPerHour && rule.maxRepliesPerHour > 0) {
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

      const hourlyUsage = await db
        .select({
          totalReplies: sql<number>`count(*)::int`,
        })
        .from(autoReplyLog)
        .where(
          and(
            eq(autoReplyLog.autoReplyId, rule.id),
            eq(autoReplyLog.responseStatus, 'sent'),
            gte(autoReplyLog.processedAt, oneHourAgo)
          )
        );

      if (hourlyUsage[0]?.totalReplies >= rule.maxRepliesPerHour) {
        return false;
      }
    }

    return true;
  }

  private checkBusinessHours(rule: typeof autoReply.$inferSelect): boolean {
    if (!rule.businessHoursStart || !rule.businessHoursEnd) {
      return true; // No business hours configured
    }

    const now = new Date();
    const timezone = rule.timezone || 'UTC';

    // Convert to rule's timezone
    const nowInTimezone = new Date(now.toLocaleString('en-US', { timeZone: timezone }));

    const currentDay = nowInTimezone.getDay(); // 0 = Sunday, 6 = Saturday
    const currentTime = nowInTimezone.getHours() * 60 + nowInTimezone.getMinutes();

    // Check if current day is in business days
    if (rule.businessDays && Array.isArray(rule.businessDays) && rule.businessDays.length > 0) {
      if (!rule.businessDays.includes(currentDay)) {
        return false;
      }
    }

    // Parse business hours
    const [startHour, startMin] = rule.businessHoursStart.split(':').map(Number);
    const [endHour, endMin] = rule.businessHoursEnd.split(':').map(Number);

    const startTime = startHour * 60 + startMin;
    const endTime = endHour * 60 + endMin;

    return currentTime >= startTime && currentTime <= endTime;
  }

  private async sendAutoReply(
    rule: typeof autoReply.$inferSelect,
    incomingMessage: IncomingMessage,
    trigger: string
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      // Add delay if configured
      if (rule.delaySeconds && rule.delaySeconds > 0) {
        await new Promise(resolve => setTimeout(resolve, rule.delaySeconds * 1000));
      }

      if (!this.baileysManager) {
        throw new Error('BaileysManager not set');
      }

      let session = await this.baileysManager.getSession(
        rule.whatsappAccountId,
        rule.organizationId
      );

      // If session doesn't exist or is not connected, try to reconnect it
      if (!session || session.status !== 'connected' || !session.socket) {
        try {
          // Attempt to reconnect the session
          await this.baileysManager.reconnectSession(rule.whatsappAccountId, rule.organizationId);

          // Wait a bit for connection to establish
          await new Promise(resolve => setTimeout(resolve, 3000));

          // Get the session again after reconnection
          session = await this.baileysManager.getSession(
            rule.whatsappAccountId,
            rule.organizationId
          );

          // Check if session is now connected
          if (!session || session.status !== 'connected' || !session.socket) {
            return { success: false, error: 'Failed to connect WhatsApp session for auto-reply' };
          }
        } catch (connectionError) {
          return {
            success: false,
            error: `Failed to reconnect session: ${connectionError instanceof Error ? connectionError.message : 'Unknown error'}`,
          };
        }
      }

      switch (rule.responseType) {
        case 'text':
          if (!rule.responseText) {
            return { success: false, error: 'No response text configured' };
          }

          const result = await session.socket.sendMessage(incomingMessage.from, {
            text: rule.responseText,
          });
          return { success: true, messageId: result?.key?.id };

        case 'media':
          if (!rule.mediaUrl || !rule.mediaType) {
            return { success: false, error: 'Media URL or type not configured' };
          }

          let mediaMessage: any = {};

          switch (rule.mediaType) {
            case 'image':
              mediaMessage = {
                image: { url: rule.mediaUrl },
                caption: rule.responseText,
              };
              break;
            case 'video':
              mediaMessage = {
                video: { url: rule.mediaUrl },
                caption: rule.responseText,
              };
              break;
            case 'audio':
              mediaMessage = { audio: { url: rule.mediaUrl } };
              break;
            case 'document':
              mediaMessage = {
                document: { url: rule.mediaUrl },
                caption: rule.responseText,
              };
              break;
          }

          const mediaResult = await session.socket.sendMessage(incomingMessage.from, mediaMessage);
          return { success: true, messageId: mediaResult?.key?.id };

        case 'forward':
          if (!rule.forwardToNumber) {
            return { success: false, error: 'Forward number not configured' };
          }

          const forwardText = `Forwarded message from ${incomingMessage.from}:\n\n${incomingMessage.text}`;
          const forwardResult = await session.socket.sendMessage(rule.forwardToNumber, {
            text: forwardText,
          });
          return { success: true, messageId: forwardResult?.key?.id };

        case 'template':
          // Template messages would need WhatsApp Business API integration
          return { success: false, error: 'Template messages not yet implemented' };

        default:
          return { success: false, error: 'Unknown response type' };
      }
    } catch (error) {
      console.error('Error sending auto reply:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private async updateUsageTracking(
    rule: typeof autoReply.$inferSelect,
    contactPhone: string
  ): Promise<void> {
    const now = new Date();
    const resetHours = rule.resetInterval || 24;
    const resetTime = new Date(now.getTime() + resetHours * 60 * 60 * 1000);

    try {
      // Try to update existing usage record
      const updated = await db
        .update(autoReplyUsage)
        .set({
          triggerCount: sql`${autoReplyUsage.triggerCount} + 1`,
          replyCount: sql`${autoReplyUsage.replyCount} + 1`,
          lastTriggered: now,
          lastReplied: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(autoReplyUsage.autoReplyId, rule.id),
            eq(autoReplyUsage.contactPhone, contactPhone),
            gte(autoReplyUsage.resetAt, now)
          )
        )
        .returning();

      // If no existing record, create new one
      if (updated.length === 0) {
        await db.insert(autoReplyUsage).values({
          autoReplyId: rule.id,
          contactPhone,
          triggerCount: 1,
          replyCount: 1,
          lastTriggered: now,
          lastReplied: now,
          resetAt: resetTime,
        });
      }
    } catch (error) {
      console.error('Error updating usage tracking:', error);
    }
  }

  private async updateRuleStats(ruleId: string, successful: boolean): Promise<void> {
    try {
      await db
        .update(autoReply)
        .set({
          totalTriggers: sql`${autoReply.totalTriggers} + 1`,
          totalReplies: successful
            ? sql`${autoReply.totalReplies} + 1`
            : sql`${autoReply.totalReplies}`,
          lastTriggered: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(autoReply.id, ruleId));
    } catch (error) {
      console.error('Error updating rule stats:', error);
    }
  }

  private async logAutoReply(
    rule: typeof autoReply.$inferSelect,
    message: IncomingMessage,
    triggerMatched: string,
    status: 'sent' | 'failed' | 'skipped',
    errorMessage?: string,
    startTime?: number,
    outgoingMessageId?: string
  ): Promise<void> {
    try {
      const responseTime = startTime ? Date.now() - startTime : undefined;

      await db.insert(autoReplyLog).values({
        autoReplyId: rule.id,
        organizationId: rule.organizationId,
        whatsappAccountId: rule.whatsappAccountId,
        contactPhone: message.from,
        contactName: message.contactName,
        incomingMessageId: message.messageId,
        incomingMessage: message.text,
        triggerMatched,
        triggerType: rule.triggerType,
        responseType: rule.responseType,
        responseText: rule.responseText,
        outgoingMessageId,
        responseStatus: status,
        errorMessage,
        responseTime,
      });
    } catch (error) {
      console.error('Error logging auto reply:', error);
    }
  }
}
