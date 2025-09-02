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
  phone: z.string()
    .min(10, 'Phone number must be at least 10 digits')
    .regex(/^[1-9]\d{9,14}$/, 'Phone number must start with country code (without +) and be 10-15 digits'),
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
    request.log.error('Error creating contact: ' + (error instanceof Error ? error.message : String(error)));
    
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
      .limit(limit)
      .offset(offset)
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
    request.log.error('Error fetching contacts: ' + (error instanceof Error ? error.message : String(error)));
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
    request.log.error('Error fetching contact: ' + (error instanceof Error ? error.message : String(error)));
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
    request.log.error('Error updating contact: ' + (error instanceof Error ? error.message : String(error)));

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
    request.log.error('Error deleting contact: ' + (error instanceof Error ? error.message : String(error)));
    return reply.status(500).send({
      error: 'Failed to delete contact',
      code: 'DELETE_CONTACT_FAILED',
    });
  }
}

export async function importContacts(request: FastifyRequest, reply: FastifyReply) {
  try {
    const body = importContactsSchema.parse(request.body);
    const headers = convertHeaders(request);

    const authSession = await auth.api.getSession({ headers });
    const organizationId = authSession?.session.activeOrganizationId;
    
    if (!organizationId) {
      return reply.status(400).send({
        error: 'Organization context required',
        code: 'ORGANIZATION_REQUIRED',
      });
    }

    const importedContacts = [];
    const errors = [];

    for (const contactData of body.contacts) {
      try {
        // Clean phone number and handle empty email
        const cleanedContactData = {
          ...contactData,
          phone: contactData.phone?.replace(/\D/g, '') || '',
          email: contactData.email && contactData.email.trim() ? contactData.email.trim() : undefined,
        };
        
        const contactId = createId();
        const newContact = {
          id: contactId,
          organizationId,
          ...cleanedContactData,
          notes: cleanedContactData.notes || null,
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
    request.log.error('Error importing contacts: ' + (error instanceof Error ? error.message : String(error)));

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
    request.log.error('Error exporting contacts: ' + (error instanceof Error ? error.message : String(error)));
    return reply.status(500).send({
      error: 'Failed to export contacts',
      code: 'EXPORT_CONTACTS_FAILED',
    });
  }
}