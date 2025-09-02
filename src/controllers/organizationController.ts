import { FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../db/drizzle';
import { organization, member } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import { z } from 'zod';

const createOrgSchema = z.object({
  name: z.string().min(1, 'Organization name is required'),
  slug: z.string().optional(),
});

export async function createOrganization(request: FastifyRequest, reply: FastifyReply) {
  try {
    const { name, slug } = createOrgSchema.parse(request.body);
    
    if (!request.user) {
      return reply.status(401).send({
        error: 'Authentication required',
        code: 'AUTH_REQUIRED',
      });
    }

    // Generate slug if not provided
    const orgSlug = slug || name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
    
    const [newOrg] = await db
      .insert(organization)
      .values({
        id: createId(),
        name,
        slug: orgSlug,
        createdAt: new Date(),
      })
      .returning();

    // Add user as admin member
    await db
      .insert(member)
      .values({
        id: createId(),
        organizationId: newOrg.id,
        userId: request.user.id,
        role: 'admin',
        createdAt: new Date(),
      });

    return reply.status(201).send({
      success: true,
      data: {
        id: newOrg.id,
        name: newOrg.name,
        slug: newOrg.slug,
        createdAt: newOrg.createdAt,
      },
    });
  } catch (error) {
    request.log.error('Error creating organization: ' + (error instanceof Error ? error.message : String(error)));
    
    if (error instanceof Error && error.message.includes('duplicate key')) {
      return reply.status(409).send({
        error: 'Organization slug already exists',
        code: 'SLUG_EXISTS',
      });
    }

    return reply.status(500).send({
      error: 'Failed to create organization',
      code: 'CREATE_ORG_FAILED',
    });
  }
}

export async function getOrganization(request: FastifyRequest, reply: FastifyReply) {
  try {
    const { id } = request.params as { id: string };

    if (!request.user) {
      return reply.status(401).send({
        error: 'Authentication required',
        code: 'AUTH_REQUIRED',
      });
    }

    // Check if user is a member of the organization
    const [orgWithMembership] = await db
      .select({
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        createdAt: organization.createdAt,
        memberRole: member.role,
      })
      .from(organization)
      .innerJoin(member, eq(member.organizationId, organization.id))
      .where(and(
        eq(organization.id, id),
        eq(member.userId, request.user.id)
      ))
      .limit(1);

    if (!orgWithMembership) {
      return reply.status(404).send({
        error: 'Organization not found or access denied',
        code: 'ORG_NOT_FOUND',
      });
    }

    return reply.send({
      success: true,
      data: {
        id: orgWithMembership.id,
        name: orgWithMembership.name,
        slug: orgWithMembership.slug,
        createdAt: orgWithMembership.createdAt,
        role: orgWithMembership.memberRole,
      },
    });
  } catch (error) {
    request.log.error('Error fetching organization: ' + (error instanceof Error ? error.message : String(error)));
    return reply.status(500).send({
      error: 'Failed to fetch organization',
      code: 'FETCH_ORG_FAILED',
    });
  }
}

export async function listUserOrganizations(request: FastifyRequest, reply: FastifyReply) {
  try {
    if (!request.user) {
      return reply.status(401).send({
        error: 'Authentication required',
        code: 'AUTH_REQUIRED',
      });
    }

    const organizations = await db
      .select({
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        createdAt: organization.createdAt,
        role: member.role,
      })
      .from(organization)
      .innerJoin(member, eq(member.organizationId, organization.id))
      .where(eq(member.userId, request.user.id));

    return reply.send({
      success: true,
      data: organizations,
    });
  } catch (error) {
    request.log.error('Error listing organizations: ' + (error instanceof Error ? error.message : String(error)));
    return reply.status(500).send({
      error: 'Failed to list organizations',
      code: 'LIST_ORGS_FAILED',
    });
  }
}