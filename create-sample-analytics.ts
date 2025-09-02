import { db } from './src/db/drizzle';
import { apiUsage, apiUsageDailyStats } from './src/db/schema/analytics';
import { createId } from '@paralleldrive/cuid2';

async function createSampleAnalyticsData() {
  try {
    console.log('Creating sample analytics data...');

    // Real organization ID from database
    const organizationId = '5AoGh6YeUHq0BCASkMdu6zuqr5tlwsc5';
    const apiKeyId = null; // Using null for dashboard requests
    const whatsappSessionId = 'jlkrlcsh21ymk5t9lmfp19jr'; // Your actual session ID

    const sampleData = [
      {
        id: createId(),
        organizationId,
        apiKeyId: null,
        whatsappSessionId,
        endpoint: '/api/v1/messages/send',
        method: 'POST',
        statusCode: 200,
        responseTime: 150,
        timestamp: new Date(Date.now() - 3600000), // 1 hour ago
        requestBody: { to: '1234567890@s.whatsapp.net', message: 'Hello World', type: 'text' },
        responseBody: { success: true, messageId: 'msg123' },
        userAgent: 'curl/7.68.0',
        ipAddress: '127.0.0.1',
        messageType: 'text',
        messageId: 'msg123',
        recipientNumber: '1234567890@s.whatsapp.net',
        errorCode: null,
        errorMessage: null,
        success: true,
      },
      {
        id: createId(),
        organizationId,
        apiKeyId: null,
        whatsappSessionId,
        endpoint: '/api/v1/whatsapp/accounts',
        method: 'GET',
        statusCode: 200,
        responseTime: 75,
        timestamp: new Date(Date.now() - 2700000), // 45 min ago
        requestBody: null,
        responseBody: { accounts: [] },
        userAgent: 'Mozilla/5.0',
        ipAddress: '127.0.0.1',
        messageType: null,
        messageId: null,
        recipientNumber: null,
        errorCode: null,
        errorMessage: null,
        success: true,
      },
      {
        id: createId(),
        organizationId,
        apiKeyId: null,
        whatsappSessionId,
        endpoint: '/api/v1/messages/send',
        method: 'POST',
        statusCode: 400,
        responseTime: 95,
        timestamp: new Date(Date.now() - 1800000), // 30 min ago
        requestBody: { to: 'invalid', message: 'Test', type: 'text' },
        responseBody: { error: 'Invalid phone number', code: 'INVALID_PHONE' },
        userAgent: 'curl/7.68.0',
        ipAddress: '127.0.0.1',
        messageType: 'text',
        messageId: null,
        recipientNumber: 'invalid',
        errorCode: 'INVALID_PHONE',
        errorMessage: 'Invalid phone number',
        success: false,
      },
      {
        id: createId(),
        organizationId,
        apiKeyId: null,
        whatsappSessionId,
        endpoint: '/api/v1/messages/send',
        method: 'POST',
        statusCode: 200,
        responseTime: 180,
        timestamp: new Date(Date.now() - 900000), // 15 min ago
        requestBody: { to: '9876543210@s.whatsapp.net', type: 'image', mediaUrl: 'https://example.com/image.jpg', caption: 'Check this out!' },
        responseBody: { success: true, messageId: 'msg456' },
        userAgent: 'PostmanRuntime/7.28.4',
        ipAddress: '192.168.1.100',
        messageType: 'image',
        messageId: 'msg456',
        recipientNumber: '9876543210@s.whatsapp.net',
        errorCode: null,
        errorMessage: null,
        success: true,
      },
      {
        id: createId(),
        organizationId,
        apiKeyId: null,
        whatsappSessionId: null,
        endpoint: '/api/v1/analytics/overview',
        method: 'GET',
        statusCode: 200,
        responseTime: 45,
        timestamp: new Date(Date.now() - 300000), // 5 min ago
        requestBody: null,
        responseBody: { overall: { totalRequests: 0 } },
        userAgent: 'Mozilla/5.0',
        ipAddress: '127.0.0.1',
        messageType: null,
        messageId: null,
        recipientNumber: null,
        errorCode: null,
        errorMessage: null,
        success: true,
      },
    ];

    // Insert sample data
    await db.insert(apiUsage).values(sampleData);

    // Create daily stats
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    await db.insert(apiUsageDailyStats).values({
      id: createId(),
      organizationId,
      apiKeyId,
      date: today,
      totalRequests: 5,
      successfulRequests: 4,
      failedRequests: 1,
      avgResponseTime: 109, // Average of the response times above
      maxResponseTime: 180,
      minResponseTime: 45,
      textMessages: 2,
      imageMessages: 1,
      videoMessages: 0,
      audioMessages: 0,
      documentMessages: 0,
      status2xx: 4,
      status4xx: 1,
      status5xx: 0,
    });

    console.log('Sample analytics data created successfully!');
    console.log(`Created ${sampleData.length} usage records and 1 daily stats record`);

  } catch (error) {
    console.error('Error creating sample data:', error);
  }
  
  process.exit(0);
}

createSampleAnalyticsData();