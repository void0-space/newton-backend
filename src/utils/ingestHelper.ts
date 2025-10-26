import { ingestEvent } from '../controllers/benefitsIngestionController';

/**
 * Easy helper function to ingest benefits from anywhere in the backend
 */
export const easyIngest = async (
  customerId: string,
  eventName: string,
  eventData: any,
  timestamp?: Date
) => {
  try {
    console.log(`🚀 Ingesting event: ${eventName} for customer: ${customerId}`);
    
    const mockRequest = {
      body: {
        customerId,
        eventName,
        eventData,
        timestamp: timestamp ? timestamp.toISOString() : new Date().toISOString(),
      },
    } as any;

    const mockReply = {
      status: (code: number) => ({
        send: (data: any) => {
          if (code !== 200) {
            throw new Error(`Ingestion failed: ${data.error || 'Unknown error'}`);
          }
          return data;
        }
      }),
      send: (data: any) => {
        console.log(`✅ Successfully ingested ${eventName}:`, data);
        return data;
      },
    } as any;

    const result = await ingestEvent(mockRequest, mockReply);
    return result;
  } catch (error) {
    console.error(`❌ Failed to ingest ${eventName}:`, error);
    throw error;
  }
};

/**
 * Predefined helpers for common events
 */
export const ingestHelpers = {
  // Ingest account creation
  accountCreated: (customerId: string, sessionId: string, phoneNumber?: string) =>
    easyIngest(customerId, 'account.created', {
      sessionId,
      phoneNumber: phoneNumber || '+1234567890',
      accountType: 'whatsapp'
    }),

  // Ingest account deletion
  accountDeleted: (customerId: string, sessionId: string) =>
    easyIngest(customerId, 'account.deleted', {
      sessionId,
      accountType: 'whatsapp'
    }),

  // Ingest message sent
  messageSent: (customerId: string, messageId: string, to: string, messageType = 'text') =>
    easyIngest(customerId, 'message.sent', {
      messageId,
      to,
      messageType
    }),

  // Ingest media upload
  mediaUploaded: (customerId: string, mediaId: string, mediaType: string, fileSize?: number) =>
    easyIngest(customerId, 'media.uploaded', {
      mediaId,
      mediaType,
      fileSize
    }),

  // Generic API call
  apiCall: (customerId: string, endpoint: string, method = 'GET') =>
    easyIngest(customerId, 'api.call', {
      endpoint,
      method
    }),

  // Custom event
  custom: (customerId: string, eventName: string, eventData: any) =>
    easyIngest(customerId, eventName, eventData)
};