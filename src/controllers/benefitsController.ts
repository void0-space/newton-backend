import { FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../db/drizzle';
import { benefits, meters, Benefit, InsertBenefit } from '../db/schema';
import { eq, desc } from 'drizzle-orm';
import { generateId } from '../utils/idGenerator';

// List all benefits with their meters
export const listBenefits = async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    const benefitsList = await db
      .select({
        id: benefits.id,
        name: benefits.name,
        type: benefits.type,
        meterId: benefits.meterId,
        creditedUnits: benefits.creditedUnits,
        isActive: benefits.isActive,
        createdAt: benefits.createdAt,
        updatedAt: benefits.updatedAt,
        meter: {
          id: meters.id,
          name: meters.name,
          aggregation: meters.aggregation,
        },
      })
      .from(benefits)
      .leftJoin(meters, eq(benefits.meterId, meters.id))
      .orderBy(desc(benefits.createdAt));

    return reply.send({
      benefits: benefitsList,
    });
  } catch (error) {
    console.error('Error listing benefits:', error);
    return reply.status(500).send({
      error: 'Failed to list benefits',
      code: 'BENEFITS_LIST_ERROR',
    });
  }
};

// Get a single benefit
export const getBenefit = async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
  try {
    const { id } = request.params;

    const benefit = await db
      .select({
        id: benefits.id,
        name: benefits.name,
        type: benefits.type,
        meterId: benefits.meterId,
        creditedUnits: benefits.creditedUnits,
        isActive: benefits.isActive,
        createdAt: benefits.createdAt,
        updatedAt: benefits.updatedAt,
        meter: {
          id: meters.id,
          name: meters.name,
          aggregation: meters.aggregation,
          filters: meters.filters,
        },
      })
      .from(benefits)
      .leftJoin(meters, eq(benefits.meterId, meters.id))
      .where(eq(benefits.id, id))
      .limit(1);

    if (benefit.length === 0) {
      return reply.status(404).send({
        error: 'Benefit not found',
        code: 'BENEFIT_NOT_FOUND',
      });
    }

    return reply.send({
      benefit: benefit[0],
    });
  } catch (error) {
    console.error('Error getting benefit:', error);
    return reply.status(500).send({
      error: 'Failed to get benefit',
      code: 'BENEFIT_GET_ERROR',
    });
  }
};

// Create a new benefit
export const createBenefit = async (request: FastifyRequest<{ Body: Omit<InsertBenefit, 'id' | 'createdAt' | 'updatedAt'> }>, reply: FastifyReply) => {
  try {
    const { name, type = 'meter', meterId, creditedUnits = 0, isActive = true } = request.body;

    if (!name) {
      return reply.status(400).send({
        error: 'Name is required',
        code: 'INVALID_INPUT',
      });
    }

    // For meter type benefits, meterId is required
    if (type === 'meter' && !meterId) {
      return reply.status(400).send({
        error: 'Meter ID is required for meter type benefits',
        code: 'INVALID_INPUT',
      });
    }

    // Validate meter exists if meterId is provided
    if (meterId) {
      const existingMeter = await db
        .select()
        .from(meters)
        .where(eq(meters.id, meterId))
        .limit(1);

      if (existingMeter.length === 0) {
        return reply.status(400).send({
          error: 'Meter not found',
          code: 'METER_NOT_FOUND',
        });
      }
    }

    const benefitId = generateId();
    const now = new Date();

    const newBenefit: InsertBenefit = {
      id: benefitId,
      name,
      type,
      meterId,
      creditedUnits,
      isActive,
      createdAt: now,
      updatedAt: now,
    };

    const [createdBenefit] = await db
      .insert(benefits)
      .values(newBenefit)
      .returning();

    return reply.status(201).send({
      benefit: createdBenefit,
    });
  } catch (error) {
    console.error('Error creating benefit:', error);
    return reply.status(500).send({
      error: 'Failed to create benefit',
      code: 'BENEFIT_CREATE_ERROR',
    });
  }
};

// Update a benefit
export const updateBenefit = async (request: FastifyRequest<{ Params: { id: string }; Body: Partial<Omit<InsertBenefit, 'id' | 'createdAt'>> }>, reply: FastifyReply) => {
  try {
    const { id } = request.params;
    const { name, type, meterId, creditedUnits, isActive } = request.body;

    // Check if benefit exists
    const existingBenefit = await db
      .select()
      .from(benefits)
      .where(eq(benefits.id, id))
      .limit(1);

    if (existingBenefit.length === 0) {
      return reply.status(404).send({
        error: 'Benefit not found',
        code: 'BENEFIT_NOT_FOUND',
      });
    }

    // Validate meter exists if meterId is provided
    if (meterId) {
      const existingMeter = await db
        .select()
        .from(meters)
        .where(eq(meters.id, meterId))
        .limit(1);

      if (existingMeter.length === 0) {
        return reply.status(400).send({
          error: 'Meter not found',
          code: 'METER_NOT_FOUND',
        });
      }
    }

    const updateData: Partial<InsertBenefit> = {
      updatedAt: new Date(),
    };

    if (name !== undefined) updateData.name = name;
    if (type !== undefined) updateData.type = type;
    if (meterId !== undefined) updateData.meterId = meterId;
    if (creditedUnits !== undefined) updateData.creditedUnits = creditedUnits;
    if (isActive !== undefined) updateData.isActive = isActive;

    const [updatedBenefit] = await db
      .update(benefits)
      .set(updateData)
      .where(eq(benefits.id, id))
      .returning();

    return reply.send({
      benefit: updatedBenefit,
    });
  } catch (error) {
    console.error('Error updating benefit:', error);
    return reply.status(500).send({
      error: 'Failed to update benefit',
      code: 'BENEFIT_UPDATE_ERROR',
    });
  }
};

// Delete a benefit
export const deleteBenefit = async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
  try {
    const { id } = request.params;

    // Check if benefit exists
    const existingBenefit = await db
      .select()
      .from(benefits)
      .where(eq(benefits.id, id))
      .limit(1);

    if (existingBenefit.length === 0) {
      return reply.status(404).send({
        error: 'Benefit not found',
        code: 'BENEFIT_NOT_FOUND',
      });
    }

    // Delete benefit
    await db
      .delete(benefits)
      .where(eq(benefits.id, id));

    return reply.send({
      message: 'Benefit deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting benefit:', error);
    return reply.status(500).send({
      error: 'Failed to delete benefit',
      code: 'BENEFIT_DELETE_ERROR',
    });
  }
};