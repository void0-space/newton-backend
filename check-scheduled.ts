import { db } from './src/db/drizzle';
import { scheduledMessage, scheduledMessageLog } from './src/db/schema';
import { desc } from 'drizzle-orm';

async function checkScheduledMessages() {
  try {
    console.log('Checking scheduled messages...');
    
    // Get recent scheduled messages
    const messages = await db.select().from(scheduledMessage)
      .orderBy(desc(scheduledMessage.createdAt))
      .limit(5);
    
    console.log(`Found ${messages.length} scheduled messages:`);
    
    for (const msg of messages) {
      console.log(`
ID: ${msg.id}
Name: ${msg.name}
Content: ${typeof msg.content === 'object' ? JSON.stringify(msg.content) : msg.content}
Recipients: ${JSON.stringify(msg.recipients)}
Status: ${msg.status}
Scheduled Time: ${msg.scheduledTime}
Session ID: ${msg.sessionId}
Organization ID: ${msg.organizationId}
Error: ${msg.errorMessage || 'None'}
Created: ${msg.createdAt}
---`);
      
      // Get logs for this message
      const logs = await db.select().from(scheduledMessageLog)
        .where((log) => log.scheduledMessageId.eq(msg.id))
        .orderBy(desc(scheduledMessageLog.attemptedAt));
        
      if (logs.length > 0) {
        console.log('Delivery logs:');
        logs.forEach(log => {
          console.log(`  - ${log.recipient}: ${log.status} (${log.attemptedAt})`);
          if (log.errorMessage) {
            console.log(`    Error: ${log.errorMessage}`);
          }
        });
      }
    }
    
  } catch (error) {
    console.error('Error checking scheduled messages:', error);
  }
  
  process.exit(0);
}

checkScheduledMessages();