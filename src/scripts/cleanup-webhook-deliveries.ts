import { db } from '../db/drizzle';
import { webhookDelivery } from '../db/schema';
import { lt } from 'drizzle-orm';

/**
 * Cleanup old webhook delivery records to reduce database size and egress costs
 * Keeps only the last 7 days of delivery records
 */
async function cleanupOldWebhookDeliveries() {
  try {
    console.log('🧹 Starting webhook delivery cleanup...');

    // Calculate date 7 days ago
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    console.log(`Deleting webhook deliveries older than: ${sevenDaysAgo.toISOString()}`);

    // Count records to be deleted
    const oldRecords = await db
      .select()
      .from(webhookDelivery)
      .where(lt(webhookDelivery.createdAt, sevenDaysAgo));

    console.log(`Found ${oldRecords.length} old records to delete`);

    if (oldRecords.length === 0) {
      console.log('✅ No old records to delete');
      return;
    }

    // Delete old records
    const result = await db
      .delete(webhookDelivery)
      .where(lt(webhookDelivery.createdAt, sevenDaysAgo));

    console.log(`✅ Successfully deleted ${oldRecords.length} old webhook delivery records`);
    console.log(`Database size reduced significantly!`);

    // Show remaining count
    const remainingRecords = await db.select().from(webhookDelivery);
    console.log(`Remaining webhook delivery records: ${remainingRecords.length}`);
  } catch (error) {
    console.error('❌ Error cleaning up webhook deliveries:', error);
    throw error;
  }
}

// Run cleanup if called directly
if (require.main === module) {
  cleanupOldWebhookDeliveries()
    .then(() => {
      console.log('Cleanup completed successfully');
      process.exit(0);
    })
    .catch(error => {
      console.error('Cleanup failed:', error);
      process.exit(1);
    });
}

export { cleanupOldWebhookDeliveries };
