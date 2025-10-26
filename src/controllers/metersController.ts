import { FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../db/drizzle';
import { meters, Meter, InsertMeter, MeterFilters } from '../db/schema';
import { eq, desc } from 'drizzle-orm';
import { generateId } from '../utils/idGenerator';

// List all meters
export const listMeters = async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    const metersList = await db
      .select()
      .from(meters)
      .orderBy(desc(meters.createdAt));

    return reply.send({
      meters: metersList,
    });
  } catch (error) {
    console.error('Error listing meters:', error);
    return reply.status(500).send({
      error: 'Failed to list meters',
      code: 'METERS_LIST_ERROR',
    });
  }
};

// Get a single meter
export const getMeter = async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
  try {
    const { id } = request.params;

    const meter = await db
      .select()
      .from(meters)
      .where(eq(meters.id, id))
      .limit(1);

    if (meter.length === 0) {
      return reply.status(404).send({
        error: 'Meter not found',
        code: 'METER_NOT_FOUND',
      });
    }

    return reply.send({
      meter: meter[0],
    });
  } catch (error) {
    console.error('Error getting meter:', error);
    return reply.status(500).send({
      error: 'Failed to get meter',
      code: 'METER_GET_ERROR',
    });
  }
};

// Create a new meter
export const createMeter = async (request: FastifyRequest<{ Body: Omit<InsertMeter, 'id' | 'createdAt' | 'updatedAt'> }>, reply: FastifyReply) => {
  try {
    const { name, filters, aggregation = 'count', isActive = true } = request.body;

    if (!name) {
      return reply.status(400).send({
        error: 'Name is required',
        code: 'INVALID_INPUT',
      });
    }

    if (!filters) {
      return reply.status(400).send({
        error: 'Filters are required',
        code: 'INVALID_INPUT',
      });
    }

    const validAggregations = ['count', 'sum', 'average', 'minimum', 'maximum', 'unique'];
    if (!validAggregations.includes(aggregation)) {
      return reply.status(400).send({
        error: 'Invalid aggregation type',
        code: 'INVALID_AGGREGATION',
      });
    }

    const meterId = generateId();
    const now = new Date();

    const newMeter: InsertMeter = {
      id: meterId,
      name,
      filters,
      aggregation,
      isActive,
      createdAt: now,
      updatedAt: now,
    };

    const [createdMeter] = await db
      .insert(meters)
      .values(newMeter)
      .returning();

    return reply.status(201).send({
      meter: createdMeter,
    });
  } catch (error) {
    console.error('Error creating meter:', error);
    return reply.status(500).send({
      error: 'Failed to create meter',
      code: 'METER_CREATE_ERROR',
    });
  }
};

// Update a meter
export const updateMeter = async (request: FastifyRequest<{ Params: { id: string }; Body: Partial<Omit<InsertMeter, 'id' | 'createdAt'>> }>, reply: FastifyReply) => {
  try {
    const { id } = request.params;
    const { name, filters, aggregation, isActive } = request.body;

    // Check if meter exists
    const existingMeter = await db
      .select()
      .from(meters)
      .where(eq(meters.id, id))
      .limit(1);

    if (existingMeter.length === 0) {
      return reply.status(404).send({
        error: 'Meter not found',
        code: 'METER_NOT_FOUND',
      });
    }

    const updateData: Partial<InsertMeter> = {
      updatedAt: new Date(),
    };

    if (name !== undefined) updateData.name = name;
    if (filters !== undefined) updateData.filters = filters;
    if (aggregation !== undefined) {
      const validAggregations = ['count', 'sum', 'average', 'minimum', 'maximum', 'unique'];
      if (!validAggregations.includes(aggregation)) {
        return reply.status(400).send({
          error: 'Invalid aggregation type',
          code: 'INVALID_AGGREGATION',
        });
      }
      updateData.aggregation = aggregation;
    }
    if (isActive !== undefined) updateData.isActive = isActive;

    const [updatedMeter] = await db
      .update(meters)
      .set(updateData)
      .where(eq(meters.id, id))
      .returning();

    return reply.send({
      meter: updatedMeter,
    });
  } catch (error) {
    console.error('Error updating meter:', error);
    return reply.status(500).send({
      error: 'Failed to update meter',
      code: 'METER_UPDATE_ERROR',
    });
  }
};

// Delete a meter
export const deleteMeter = async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
  try {
    const { id } = request.params;

    // Check if meter exists
    const existingMeter = await db
      .select()
      .from(meters)
      .where(eq(meters.id, id))
      .limit(1);

    if (existingMeter.length === 0) {
      return reply.status(404).send({
        error: 'Meter not found',
        code: 'METER_NOT_FOUND',
      });
    }

    // Delete meter
    await db
      .delete(meters)
      .where(eq(meters.id, id));

    return reply.send({
      message: 'Meter deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting meter:', error);
    return reply.status(500).send({
      error: 'Failed to delete meter',
      code: 'METER_DELETE_ERROR',
    });
  }
};