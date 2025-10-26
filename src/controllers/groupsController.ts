import { FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../db/drizzle';
import { contactGroup, contact } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import { convertHeaders } from '../utils/header';
import { auth } from '../lib/auth';

export const groupsController = {
  // Get all groups for organization
  async getGroups(request: FastifyRequest, reply: FastifyReply) {
    try {
      const headers = convertHeaders(request);
      const authSession = await auth.api.getSession({ headers });
      const organizationId = authSession?.session.activeOrganizationId;

      if (!organizationId) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const groups = await db
        .select()
        .from(contactGroup)
        .where(eq(contactGroup.organizationId, organizationId));

      return reply.send({
        success: true,
        data: groups,
        count: groups.length,
      });
    } catch (error) {
      console.error('Error fetching groups:', error);
      return reply.status(500).send({
        error: 'Failed to fetch groups',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  },

  // Get single group with participants
  async getGroup(request: FastifyRequest, reply: FastifyReply) {
    try {
      const headers = convertHeaders(request);
      const authSession = await auth.api.getSession({ headers });
      const organizationId = authSession?.session.activeOrganizationId;

      if (!organizationId) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const { id } = request.params as { id: string };

      const [group] = await db
        .select()
        .from(contactGroup)
        .where(and(eq(contactGroup.id, id), eq(contactGroup.organizationId, organizationId)))
        .limit(1);

      if (!group) {
        return reply.status(404).send({ error: 'Group not found' });
      }

      // Get contacts in this group
      const groupContacts = await db
        .select()
        .from(contact)
        .where(eq(contact.organizationId, organizationId));

      const membersInGroup = groupContacts.filter((c) =>
        (c.groups || []).includes(group.name)
      );

      console.log(`Group "${group.name}" lookup:`, {
        groupId: group.id,
        groupName: group.name,
        totalContacts: groupContacts.length,
        contactGroupsArraySample: groupContacts.slice(0, 3).map(c => ({ name: c.name, groups: c.groups })),
        matchingMembers: membersInGroup.length,
        memberPhones: membersInGroup.map(m => m.phone),
      });

      return reply.send({
        success: true,
        data: {
          ...group,
          members: membersInGroup,
          memberCount: membersInGroup.length,
        },
      });
    } catch (error) {
      console.error('Error fetching group:', error);
      return reply.status(500).send({
        error: 'Failed to fetch group',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  },

  // Create new group
  async createGroup(request: FastifyRequest, reply: FastifyReply) {
    try {
      const headers = convertHeaders(request);
      const authSession = await auth.api.getSession({ headers });
      const organizationId = authSession?.session.activeOrganizationId;

      if (!organizationId) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const { name, description, color } = request.body as {
        name: string;
        description?: string;
        color?: string;
      };

      if (!name || name.trim() === '') {
        return reply.status(400).send({ error: 'Group name is required' });
      }

      // Check if group already exists
      const [existing] = await db
        .select()
        .from(contactGroup)
        .where(
          and(
            eq(contactGroup.organizationId, organizationId),
            eq(contactGroup.name, name.trim())
          )
        )
        .limit(1);

      if (existing) {
        return reply.status(400).send({ error: 'Group with this name already exists' });
      }

      const newGroup = {
        id: createId(),
        organizationId,
        name: name.trim(),
        description: description?.trim() || null,
        color: color || null,
        whatsappGroupId: null,
        participantCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const [created] = await db.insert(contactGroup).values(newGroup).returning();

      return reply.status(201).send({
        success: true,
        data: created,
        message: 'Group created successfully',
      });
    } catch (error) {
      console.error('Error creating group:', error);
      return reply.status(500).send({
        error: 'Failed to create group',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  },

  // Update group
  async updateGroup(request: FastifyRequest, reply: FastifyReply) {
    try {
      const headers = convertHeaders(request);
      const authSession = await auth.api.getSession({ headers });
      const organizationId = authSession?.session.activeOrganizationId;

      if (!organizationId) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const { id } = request.params as { id: string };
      const { name, description, color } = request.body as {
        name?: string;
        description?: string;
        color?: string;
      };

      const [group] = await db
        .select()
        .from(contactGroup)
        .where(and(eq(contactGroup.id, id), eq(contactGroup.organizationId, organizationId)))
        .limit(1);

      if (!group) {
        return reply.status(404).send({ error: 'Group not found' });
      }

      // If renaming group, update all contacts with old group name
      if (name && name !== group.name) {
        const groupContacts = await db
          .select()
          .from(contact)
          .where(eq(contact.organizationId, organizationId));

        for (const c of groupContacts) {
          if ((c.groups || []).includes(group.name)) {
            const updatedGroups = (c.groups || []).map((g) => (g === group.name ? name : g));
            await db
              .update(contact)
              .set({ groups: updatedGroups, updatedAt: new Date() })
              .where(eq(contact.id, c.id));
          }
        }
      }

      await db
        .update(contactGroup)
        .set({
          name: name || group.name,
          description: description !== undefined ? description : group.description,
          color: color !== undefined ? color : group.color,
          updatedAt: new Date(),
        })
        .where(eq(contactGroup.id, id));

      const [updated] = await db
        .select()
        .from(contactGroup)
        .where(eq(contactGroup.id, id))
        .limit(1);

      return reply.send({
        success: true,
        data: updated,
        message: 'Group updated successfully',
      });
    } catch (error) {
      console.error('Error updating group:', error);
      return reply.status(500).send({
        error: 'Failed to update group',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  },

  // Delete group
  async deleteGroup(request: FastifyRequest, reply: FastifyReply) {
    try {
      const headers = convertHeaders(request);
      const authSession = await auth.api.getSession({ headers });
      const organizationId = authSession?.session.activeOrganizationId;

      if (!organizationId) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const { id } = request.params as { id: string };

      const [group] = await db
        .select()
        .from(contactGroup)
        .where(and(eq(contactGroup.id, id), eq(contactGroup.organizationId, organizationId)))
        .limit(1);

      if (!group) {
        return reply.status(404).send({ error: 'Group not found' });
      }

      // Remove group from all contacts
      const groupContacts = await db
        .select()
        .from(contact)
        .where(eq(contact.organizationId, organizationId));

      for (const c of groupContacts) {
        if ((c.groups || []).includes(group.name)) {
          const updatedGroups = (c.groups || []).filter((g) => g !== group.name);
          await db
            .update(contact)
            .set({ groups: updatedGroups, updatedAt: new Date() })
            .where(eq(contact.id, c.id));
        }
      }

      // Delete the group
      await db.delete(contactGroup).where(eq(contactGroup.id, id));

      return reply.send({
        success: true,
        message: 'Group deleted successfully',
      });
    } catch (error) {
      console.error('Error deleting group:', error);
      return reply.status(500).send({
        error: 'Failed to delete group',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  },

  // Add contacts to group
  async addContactsToGroup(request: FastifyRequest, reply: FastifyReply) {
    try {
      const headers = convertHeaders(request);
      const authSession = await auth.api.getSession({ headers });
      const organizationId = authSession?.session.activeOrganizationId;

      if (!organizationId) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const { id } = request.params as { id: string };
      const { contactIds } = request.body as { contactIds: string[] };

      if (!Array.isArray(contactIds) || contactIds.length === 0) {
        return reply.status(400).send({ error: 'Contact IDs array is required' });
      }

      const [group] = await db
        .select()
        .from(contactGroup)
        .where(and(eq(contactGroup.id, id), eq(contactGroup.organizationId, organizationId)))
        .limit(1);

      if (!group) {
        return reply.status(404).send({ error: 'Group not found' });
      }

      // Update contacts
      let addedCount = 0;
      for (const contactId of contactIds) {
        const [contactRecord] = await db
          .select()
          .from(contact)
          .where(and(eq(contact.id, contactId), eq(contact.organizationId, organizationId)))
          .limit(1);

        if (contactRecord) {
          const currentGroups = contactRecord.groups || [];
          if (!currentGroups.includes(group.name)) {
            await db
              .update(contact)
              .set({
                groups: [...currentGroups, group.name],
                updatedAt: new Date(),
              })
              .where(eq(contact.id, contactId));
            addedCount++;
          }
        }
      }

      // Update group participant count
      const allContacts = await db
        .select()
        .from(contact)
        .where(eq(contact.organizationId, organizationId));

      const membersInGroup = allContacts.filter((c) =>
        (c.groups || []).includes(group.name)
      ).length;

      await db
        .update(contactGroup)
        .set({ participantCount: membersInGroup, updatedAt: new Date() })
        .where(eq(contactGroup.id, id));

      return reply.send({
        success: true,
        message: `Added ${addedCount} contacts to group`,
        addedCount,
      });
    } catch (error) {
      console.error('Error adding contacts to group:', error);
      return reply.status(500).send({
        error: 'Failed to add contacts to group',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  },

  // Remove contacts from group
  async removeContactsFromGroup(request: FastifyRequest, reply: FastifyReply) {
    try {
      const headers = convertHeaders(request);
      const authSession = await auth.api.getSession({ headers });
      const organizationId = authSession?.session.activeOrganizationId;

      if (!organizationId) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const { id } = request.params as { id: string };
      const { contactIds } = request.body as { contactIds: string[] };

      if (!Array.isArray(contactIds) || contactIds.length === 0) {
        return reply.status(400).send({ error: 'Contact IDs array is required' });
      }

      const [group] = await db
        .select()
        .from(contactGroup)
        .where(and(eq(contactGroup.id, id), eq(contactGroup.organizationId, organizationId)))
        .limit(1);

      if (!group) {
        return reply.status(404).send({ error: 'Group not found' });
      }

      // Update contacts
      let removedCount = 0;
      for (const contactId of contactIds) {
        const [contactRecord] = await db
          .select()
          .from(contact)
          .where(and(eq(contact.id, contactId), eq(contact.organizationId, organizationId)))
          .limit(1);

        if (contactRecord) {
          const currentGroups = contactRecord.groups || [];
          if (currentGroups.includes(group.name)) {
            await db
              .update(contact)
              .set({
                groups: currentGroups.filter((g) => g !== group.name),
                updatedAt: new Date(),
              })
              .where(eq(contact.id, contactId));
            removedCount++;
          }
        }
      }

      // Update group participant count
      const allContacts = await db
        .select()
        .from(contact)
        .where(eq(contact.organizationId, organizationId));

      const membersInGroup = allContacts.filter((c) =>
        (c.groups || []).includes(group.name)
      ).length;

      await db
        .update(contactGroup)
        .set({ participantCount: membersInGroup, updatedAt: new Date() })
        .where(eq(contactGroup.id, id));

      return reply.send({
        success: true,
        message: `Removed ${removedCount} contacts from group`,
        removedCount,
      });
    } catch (error) {
      console.error('Error removing contacts from group:', error);
      return reply.status(500).send({
        error: 'Failed to remove contacts from group',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  },
};
