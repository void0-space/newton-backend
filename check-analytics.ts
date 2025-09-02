import { db } from './src/db/drizzle';
import { apiUsage } from './src/db/schema/analytics';

async function checkAnalyticsData() {
  try {
    console.log('Checking analytics data...');
    
    const data = await db.select().from(apiUsage).limit(10);
    console.log(`Found ${data.length} analytics records`);
    
    if (data.length > 0) {
      console.log('Sample records:');
      data.forEach((record, index) => {
        console.log(`${index + 1}:`, {
          id: record.id,
          endpoint: record.endpoint,
          method: record.method,
          statusCode: record.statusCode,
          timestamp: record.timestamp,
          organizationId: record.organizationId
        });
      });
    } else {
      console.log('No analytics data found. This means:');
      console.log('1. Analytics middleware might not be running');
      console.log('2. No API requests have been made since the analytics were set up');
      console.log('3. API requests are being made to endpoints that are not being tracked');
    }
  } catch (error) {
    console.error('Error checking analytics data:', error);
  }
  
  process.exit(0);
}

checkAnalyticsData();