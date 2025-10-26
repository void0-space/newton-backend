import { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { createId } from '@paralleldrive/cuid2';
import { convertHeaders } from '../utils/header';
import { auth } from '../lib/auth';
import { db } from '../db/drizzle';
import { contact, contactGroup, contactTag } from '../db/schema';
import { eq, and, ilike, or, count } from 'drizzle-orm';

const createContactSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  phone: z
    .string()
    .min(10, 'Phone number must be at least 10 digits')
    .regex(
      /^[1-9]\d{9,14}$/,
      'Phone number must start with country code (without +) and be 10-15 digits'
    ),
  email: z.string().optional(),
  groups: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  notes: z.string().optional(),
});

const updateContactSchema = createContactSchema.partial().extend({
  id: z.string(),
});

const importContactsSchema = z.object({
  contacts: z.array(createContactSchema),
});

declare module 'fastify' {
  interface FastifyInstance {
    contacts: any; // Will be replaced with actual contacts service
  }
}

export async function createContact(request: FastifyRequest, reply: FastifyReply) {
  try {
    // Preprocess phone number to remove + and any non-digits
    // Also handle empty email strings
    const rawBody = request.body as any;
    if (rawBody?.phone) {
      rawBody.phone = rawBody.phone.replace(/\D/g, '');
    }
    if (rawBody?.email === '') {
      rawBody.email = undefined;
    }

    const body = createContactSchema.parse(rawBody);
    const headers = convertHeaders(request);

    const authSession = await auth.api.getSession({ headers });
    const organizationId = authSession?.session.activeOrganizationId;

    if (!organizationId) {
      return reply.status(400).send({
        error: 'Organization context required',
        code: 'ORGANIZATION_REQUIRED',
      });
    }

    const contactId = createId();
    const contactData = {
      id: contactId,
      organizationId,
      name: body.name,
      phone: body.phone,
      email: body.email || null,
      groups: body.groups,
      tags: body.tags,
      notes: body.notes || null,
    };

    const [createdContact] = await db.insert(contact).values(contactData).returning();

    return reply.status(201).send({
      success: true,
      data: createdContact,
    });
  } catch (error) {
    request.log.error(
      'Error creating contact: ' + (error instanceof Error ? error.message : String(error))
    );

    if (error instanceof z.ZodError) {
      return reply.status(400).send({
        error: 'Validation error',
        code: 'VALIDATION_ERROR',
        details: error.errors,
      });
    }

    return reply.status(500).send({
      error: 'Failed to create contact',
      code: 'CREATE_CONTACT_FAILED',
    });
  }
}

export async function getContacts(request: FastifyRequest, reply: FastifyReply) {
  try {
    const headers = convertHeaders(request);
    const authSession = await auth.api.getSession({ headers });

    const organizationId = authSession?.session.activeOrganizationId;
    if (!organizationId) {
      return reply.status(400).send({
        error: 'Organization context required',
        code: 'ORGANIZATION_REQUIRED',
      });
    }

    const query = request.query as {
      page?: string;
      limit?: string;
      search?: string;
      groups?: string;
      tags?: string;
    };

    const page = parseInt(query.page || '1', 10);
    const limit = parseInt(query.limit || '20', 10);
    const offset = (page - 1) * limit;

    // Build the query with filters
    let whereConditions = [eq(contact.organizationId, organizationId)];

    // Add search condition
    if (query.search) {
      whereConditions.push(
        or(
          ilike(contact.name, `%${query.search}%`),
          ilike(contact.phone, `%${query.search}%`),
          ilike(contact.email, `%${query.search}%`),
          ilike(contact.notes, `%${query.search}%`)
        )
      );
    }

    // For groups and tags filtering, we'll use SQL JSON operators
    // This is a simplified version - in a real app you might want more sophisticated filtering

    const contacts = await db
      .select()
      .from(contact)
      .where(and(...whereConditions))
      // .limit(limit)
      // .offset(offset)
      .orderBy(contact.createdAt);

    // Get total count for pagination
    const [{ total }] = await db
      .select({ total: count() })
      .from(contact)
      .where(and(...whereConditions));

    return reply.send({
      success: true,
      data: contacts,
      pagination: {
        page,
        limit,
        total,
        hasMore: contacts.length === limit,
      },
    });
  } catch (error) {
    request.log.error(
      'Error fetching contacts: ' + (error instanceof Error ? error.message : String(error))
    );
    return reply.status(500).send({
      error: 'Failed to fetch contacts',
      code: 'FETCH_CONTACTS_FAILED',
    });
  }
}

export async function getContact(request: FastifyRequest, reply: FastifyReply) {
  try {
    const { id } = request.params as { id: string };
    const headers = convertHeaders(request);

    const authSession = await auth.api.getSession({ headers });
    const organizationId = authSession?.session.activeOrganizationId;

    if (!organizationId) {
      return reply.status(400).send({
        error: 'Organization context required',
        code: 'ORGANIZATION_REQUIRED',
      });
    }

    const [foundContact] = await db
      .select()
      .from(contact)
      .where(and(eq(contact.id, id), eq(contact.organizationId, organizationId)))
      .limit(1);

    if (!foundContact) {
      return reply.status(404).send({
        error: 'Contact not found',
        code: 'CONTACT_NOT_FOUND',
      });
    }

    return reply.send({
      success: true,
      data: foundContact,
    });
  } catch (error) {
    request.log.error(
      'Error fetching contact: ' + (error instanceof Error ? error.message : String(error))
    );
    return reply.status(500).send({
      error: 'Failed to fetch contact',
      code: 'FETCH_CONTACT_FAILED',
    });
  }
}

export async function updateContact(request: FastifyRequest, reply: FastifyReply) {
  try {
    const { id } = request.params as { id: string };

    // Preprocess phone number to remove + and any non-digits
    // Also handle empty email strings
    const rawBody = request.body as any;
    if (rawBody?.phone) {
      rawBody.phone = rawBody.phone.replace(/\D/g, '');
    }
    if (rawBody?.email === '') {
      rawBody.email = undefined;
    }

    const body = updateContactSchema.parse({ ...rawBody, id });
    const headers = convertHeaders(request);

    const authSession = await auth.api.getSession({ headers });
    const organizationId = authSession?.session.activeOrganizationId;

    if (!organizationId) {
      return reply.status(400).send({
        error: 'Organization context required',
        code: 'ORGANIZATION_REQUIRED',
      });
    }

    const updateData = {
      ...body,
      id: undefined, // Remove id from update data
      updatedAt: new Date(),
    };

    const [updatedContact] = await db
      .update(contact)
      .set(updateData)
      .where(and(eq(contact.id, id), eq(contact.organizationId, organizationId)))
      .returning();

    if (!updatedContact) {
      return reply.status(404).send({
        error: 'Contact not found',
        code: 'CONTACT_NOT_FOUND',
      });
    }

    return reply.send({
      success: true,
      data: updatedContact,
    });
  } catch (error) {
    request.log.error(
      'Error updating contact: ' + (error instanceof Error ? error.message : String(error))
    );

    if (error instanceof z.ZodError) {
      return reply.status(400).send({
        error: 'Validation error',
        code: 'VALIDATION_ERROR',
        details: error.errors,
      });
    }

    return reply.status(500).send({
      error: 'Failed to update contact',
      code: 'UPDATE_CONTACT_FAILED',
    });
  }
}

export async function deleteContact(request: FastifyRequest, reply: FastifyReply) {
  try {
    const { id } = request.params as { id: string };
    const headers = convertHeaders(request);

    const authSession = await auth.api.getSession({ headers });
    const organizationId = authSession?.session.activeOrganizationId;

    if (!organizationId) {
      return reply.status(400).send({
        error: 'Organization context required',
        code: 'ORGANIZATION_REQUIRED',
      });
    }

    const [deletedContact] = await db
      .delete(contact)
      .where(and(eq(contact.id, id), eq(contact.organizationId, organizationId)))
      .returning();

    if (!deletedContact) {
      return reply.status(404).send({
        error: 'Contact not found',
        code: 'CONTACT_NOT_FOUND',
      });
    }

    return reply.send({
      success: true,
      message: 'Contact deleted successfully',
    });
  } catch (error) {
    request.log.error(
      'Error deleting contact: ' + (error instanceof Error ? error.message : String(error))
    );
    return reply.status(500).send({
      error: 'Failed to delete contact',
      code: 'DELETE_CONTACT_FAILED',
    });
  }
}

export async function importContacts(request: FastifyRequest, reply: FastifyReply) {
  try {
    const body = request.body as any;
    const headers = convertHeaders(request);

    const authSession = await auth.api.getSession({ headers });
    const organizationId = authSession?.session.activeOrganizationId;

    if (!organizationId) {
      return reply.status(400).send({
        error: 'Organization context required',
        code: 'ORGANIZATION_REQUIRED',
      });
    }

    let contactsToImport = [];

    // Handle CSV import
    if (body.csvData) {
      const lines = body.csvData.trim().split('\n');
      for (const line of lines) {
        if (line.trim()) {
          const [name, phone, email = '', groups = '', tags = '', notes = ''] = line
            .split(',')
            .map((field: string) => field.trim().replace(/^"/, '').replace(/"$/, ''));
          if (name && phone) {
            contactsToImport.push({
              name,
              phone: phone.replace(/\D/g, ''),
              email: email || undefined,
              groups: groups
                ? groups
                    .split(';')
                    .map((g: string) => g.trim())
                    .filter(Boolean)
                : [],
              tags: tags
                ? tags
                    .split(';')
                    .map((t: string) => t.trim())
                    .filter(Boolean)
                : [],
              notes: notes || undefined,
            });
          }
        }
      }
    }
    // Handle WhatsApp import
    else if (body.type === 'whatsapp' && body.sessionId) {
      // For WhatsApp import, we'll import from the session's chat contacts
      // This is a simplified version - in reality you'd fetch from WhatsApp
      const whatsappContacts = body.contacts || [];
      contactsToImport = whatsappContacts.map((contact: any) => ({
        name: contact.name || contact.phoneNumber || 'Unknown',
        phone: (contact.phoneNumber || contact.phone || '').replace(/\D/g, ''),
        email: contact.email || undefined,
        groups: contact.groups || [],
        tags: ['whatsapp-import'],
        notes: contact.notes || `Imported from WhatsApp session ${body.sessionId}`,
      }));
    }
    // Handle direct contacts array import
    else if (body.contacts) {
      const parsedBody = importContactsSchema.parse(body);
      contactsToImport = parsedBody.contacts;
    } else {
      return reply.status(400).send({
        error: 'Invalid import data. Provide csvData, contacts array, or WhatsApp import data.',
        code: 'INVALID_IMPORT_DATA',
      });
    }

    const importedContacts = [];
    const errors = [];

    for (const contactData of contactsToImport) {
      try {
        // Validate the contact data
        const validatedContact = createContactSchema.parse({
          ...contactData,
          phone: contactData.phone?.replace(/\D/g, '') || '',
          email:
            contactData.email && contactData.email.trim() ? contactData.email.trim() : undefined,
        });

        const contactId = createId();
        const newContact = {
          id: contactId,
          organizationId,
          ...validatedContact,
          notes: validatedContact.notes || null,
        };

        const [createdContact] = await db.insert(contact).values(newContact).returning();
        importedContacts.push(createdContact);
      } catch (error) {
        errors.push({
          contact: contactData,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return reply.send({
      success: true,
      data: {
        imported: importedContacts.length,
        errors: errors.length,
        details: errors,
      },
    });
  } catch (error) {
    request.log.error(
      'Error importing contacts: ' + (error instanceof Error ? error.message : String(error))
    );

    if (error instanceof z.ZodError) {
      return reply.status(400).send({
        error: 'Validation error',
        code: 'VALIDATION_ERROR',
        details: error.errors,
      });
    }

    return reply.status(500).send({
      error: 'Failed to import contacts',
      code: 'IMPORT_CONTACTS_FAILED',
    });
  }
}

export async function getWhatsAppContacts(request: FastifyRequest, reply: FastifyReply) {
  try {
    const headers = convertHeaders(request);
    const authSession = await auth.api.getSession({ headers });

    const organizationId = authSession?.session.activeOrganizationId;
    if (!organizationId) {
      return reply.status(400).send({
        error: 'Organization context required',
        code: 'ORGANIZATION_REQUIRED',
      });
    }

    const { sessionId } = request.params as { sessionId: string };

    // Get the session from Baileys manager
    const session = await request.server.baileys?.getSession(sessionId, organizationId);

    if (!session || !session.socket || session.status !== 'connected') {
      // return reply.status(400).send({
      //   error: 'WhatsApp session not connected',
      //   code: 'SESSION_NOT_CONNECTED',
      // });
      await session.socket.waitForConnectionUpdate(); // Wait for connection
      if (session.status !== 'connected') {
        return reply.status(400).send({
          error: 'WhatsApp session not connected',
          code: 'SESSION_NOT_CONNECTED',
        });
      }
    }

    try {
      request.log.info(`Attempting to fetch real WhatsApp contacts for session ${sessionId}`);

      // First, try to get contacts from the actual WhatsApp session store
      let realContacts: any[] = [];

      // Log available properties on the session socket for debugging
      request.log.info(`Session socket properties: ${Object.keys(session.socket).join(', ')}`);

      // Try to get contacts from groups (people you chat with in groups)
      try {
        request.log.info('Attempting to fetch group participants as potential contacts');
        const groups = await session.socket.groupFetchAllParticipating();
        const message = await session.socket.fetchMessageHistory();
        request.log.info(`Message history: ${message}`);
        request.log.info(`Found ${Object.keys(groups).length} groups: ${JSON.stringify(groups)}`);

        const participantMap = new Map();

        Object.entries(groups).forEach(([groupJid, group]: [string, any]) => {
          if (group.participants) {
            group.participants.forEach((participant: any) => {
              const jid = participant.id;
              if (jid && jid.includes('@s.whatsapp.net') && !jid.includes('@g.us')) {
                const phoneNumber = jid.split('@')[0];
                if (phoneNumber.match(/^\d+$/) && !participantMap.has(phoneNumber)) {
                  participantMap.set(phoneNumber, {
                    phoneNumber,
                    name: participant.notify || participant.verifiedName || phoneNumber,
                    jid,
                    source: 'group_participant',
                  });
                }
              }
            });
          }
        });

        realContacts = Array.from(participantMap.values());
        request.log.info(
          `Extracted ${realContacts.length} unique contacts from group participants`
        );
      } catch (groupError) {
        request.log.warn(`Failed to fetch group participants: ${groupError}`);
      }

      // If still no real contacts, try to get from message history
      if (realContacts.length === 0) {
        request.log.info('No contacts from store, trying message history');

        const { message } = await import('../db/schema');
        const messageContacts = await db
          .select({
            from: message.from,
            to: message.to,
            content: message.content,
          })
          .from(message)
          .where(and(eq(message.organizationId, organizationId), eq(message.sessionId, sessionId)))
          .limit(100);

        request.log.info(`Found ${messageContacts.length} messages in history`);

        // Extract unique contacts from message history
        const contactMap = new Map();
        messageContacts.forEach(msg => {
          if (msg.from && msg.from.includes('@s.whatsapp.net')) {
            const phoneNumber = msg.from.split('@')[0];
            if (phoneNumber.match(/^\d+$/)) {
              let name = phoneNumber;
              try {
                const contentObj =
                  typeof msg.content === 'string' ? JSON.parse(msg.content) : msg.content;
                if (contentObj?.participant) {
                  name = contentObj.participant.split('@')[0];
                }
              } catch (e) {
                // Use phone number as name
              }

              if (!contactMap.has(phoneNumber)) {
                contactMap.set(phoneNumber, {
                  phoneNumber,
                  name: name || phoneNumber,
                  jid: msg.from,
                });
              }
            }
          }
        });

        realContacts = Array.from(contactMap.values());
        request.log.info(`Extracted ${realContacts.length} unique contacts from message history`);
      }

      // Only return real contacts if we found any
      if (realContacts.length > 0) {
        request.log.info(`Returning ${realContacts.length} real contacts`);
        return reply.send({
          success: true,
          data: {
            sessionId,
            contacts: realContacts,
            count: realContacts.length,
          },
        });
      }

      // If no real contacts found, inform the user
      request.log.info('No real contacts found - returning empty array with explanation');
      return reply.send({
        success: true,
        data: {
          sessionId,
          contacts: [],
          count: 0,
          message:
            'No WhatsApp contacts found. This could be because: 1) No messages have been received yet, 2) WhatsApp contacts are not synced to this session, or 3) The session needs to be reconnected.',
        },
      });
    } catch (whatsappError) {
      // Enhanced error logging
      request.log.error(
        `Error fetching WhatsApp contacts: ${whatsappError instanceof Error ? whatsappError.message : JSON.stringify(whatsappError)}`
      );

      return reply.status(500).send({
        success: false,
        error: 'Failed to fetch WhatsApp contacts',
        details: whatsappError instanceof Error ? whatsappError.message : 'Unknown error',
      });
    }
  } catch (error) {
    request.log.error(
      'Error fetching WhatsApp contacts: ' +
        (error instanceof Error ? error.message : String(error))
    );
    return reply.status(500).send({
      error: 'Failed to fetch WhatsApp contacts',
      code: 'FETCH_WHATSAPP_CONTACTS_FAILED',
    });
  }
}

export async function getWhatsAppGroups(request: FastifyRequest, reply: FastifyReply) {
  try {
    const headers = convertHeaders(request);
    const authSession = await auth.api.getSession({ headers });

    const organizationId = authSession?.session.activeOrganizationId;
    if (!organizationId) {
      return reply.status(400).send({
        error: 'Organization context required',
        code: 'ORGANIZATION_REQUIRED',
      });
    }

    const { sessionId } = request.params as { sessionId: string };

    // Get the session from Baileys manager
    const session = await (request.server as any).baileys?.getSession(sessionId, organizationId);

    if (!session || !session.socket || session.status !== 'connected') {
      return reply.status(400).send({
        error: 'WhatsApp session not connected',
        code: 'SESSION_NOT_CONNECTED',
      });
    }

    try {
      // Get groups from WhatsApp
      const whatsappGroups = await session.socket.groupFetchAllParticipating();

      // Format groups for import
      const formattedGroups = Object.entries(whatsappGroups).map(([jid, group]: [string, any]) => ({
        jid,
        name: group.subject || 'Unknown Group',
        description: group.desc || '',
        participantCount: group.participants?.length || 0,
        participants:
          group.participants?.map((p: any) => p.id?.split('@')[0]).filter(Boolean) || [],
      }));

      return reply.send({
        success: true,
        data: {
          sessionId,
          groups: formattedGroups,
          count: formattedGroups.length,
        },
      });
    } catch (whatsappError) {
      // Fallback: return empty array
      request.log.warn('Could not fetch WhatsApp groups, returning empty array:', whatsappError);
      return reply.send({
        success: true,
        data: {
          sessionId,
          groups: [],
          count: 0,
        },
      });
    }
  } catch (error) {
    request.log.error(
      'Error fetching WhatsApp groups: ' + (error instanceof Error ? error.message : String(error))
    );
    return reply.status(500).send({
      error: 'Failed to fetch WhatsApp groups',
      code: 'FETCH_WHATSAPP_GROUPS_FAILED',
    });
  }
}

export async function exportContacts(request: FastifyRequest, reply: FastifyReply) {
  try {
    const headers = convertHeaders(request);
    const authSession = await auth.api.getSession({ headers });

    const organizationId = authSession?.session.activeOrganizationId;
    if (!organizationId) {
      return reply.status(400).send({
        error: 'Organization context required',
        code: 'ORGANIZATION_REQUIRED',
      });
    }

    const contacts = await db
      .select()
      .from(contact)
      .where(eq(contact.organizationId, organizationId))
      .orderBy(contact.createdAt);

    // Generate CSV content
    const csvHeaders = ['Name', 'Phone', 'Email', 'Groups', 'Tags', 'Notes'];
    const csvRows = contacts.map(contact => [
      contact.name,
      contact.phone,
      contact.email || '',
      Array.isArray(contact.groups) ? contact.groups.join(';') : '',
      Array.isArray(contact.tags) ? contact.tags.join(';') : '',
      contact.notes || '',
    ]);

    const csvContent = [
      csvHeaders.join(','),
      ...csvRows.map(row => row.map(field => `"${field}"`).join(',')),
    ].join('\n');

    reply.header('Content-Type', 'text/csv');
    reply.header('Content-Disposition', 'attachment; filename="contacts.csv"');

    return reply.send(csvContent);
  } catch (error) {
    request.log.error(
      'Error exporting contacts: ' + (error instanceof Error ? error.message : String(error))
    );
    return reply.status(500).send({
      error: 'Failed to export contacts',
      code: 'EXPORT_CONTACTS_FAILED',
    });
  }
}
