import { FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../db/drizzle';
import { products, productBenefits, productBenefitsAssignment, benefits, meters, Product, InsertProduct, ProductBenefit, InsertProductBenefit, InsertProductBenefitsAssignment } from '../db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { generateId } from '../utils/idGenerator';

// List all products
export const listProducts = async (request: FastifyRequest, reply: FastifyReply) => {
  try {

    const productsList = await db
      .select()
      .from(products)
      .orderBy(desc(products.createdAt));

    return reply.send({
      products: productsList,
    });
  } catch (error) {
    console.error('Error listing products:', error);
    return reply.status(500).send({
      error: 'Failed to list products',
      code: 'PRODUCTS_LIST_ERROR',
    });
  }
};

// Get a single product with benefits
export const getProduct = async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
  try {

    const { id } = request.params;

    // Get product
    const product = await db
      .select()
      .from(products)
      .where(eq(products.id, id))
      .limit(1);

    if (product.length === 0) {
      return reply.status(404).send({
        error: 'Product not found',
        code: 'PRODUCT_NOT_FOUND',
      });
    }

    // Get product benefits
    const benefits = await db
      .select()
      .from(productBenefits)
      .where(eq(productBenefits.productId, id))
      .orderBy(productBenefits.order);

    return reply.send({
      product: product[0],
      benefits,
    });
  } catch (error) {
    console.error('Error getting product:', error);
    return reply.status(500).send({
      error: 'Failed to get product',
      code: 'PRODUCT_GET_ERROR',
    });
  }
};

// Create a new product
export const createProduct = async (request: FastifyRequest<{ Body: Omit<InsertProduct, 'id' | 'createdAt' | 'updatedAt'> }>, reply: FastifyReply) => {
  try {

    const { name, description, frequency, type = 'fixed', price, razorpayPlanId, popular = false, isActive = true } = request.body;

    if (!name || !frequency || !razorpayPlanId) {
      return reply.status(400).send({
        error: 'Name, frequency, and Razorpay Plan ID are required',
        code: 'INVALID_INPUT',
      });
    }

    if (!['monthly', 'yearly'].includes(frequency)) {
      return reply.status(400).send({
        error: 'Frequency must be monthly or yearly',
        code: 'INVALID_FREQUENCY',
      });
    }

    const productId = generateId();
    const now = new Date();

    const newProduct: InsertProduct = {
      id: productId,
      name,
      description: description || null,
      frequency: frequency as 'monthly' | 'yearly',
      type: 'fixed',
      price: price?.toString() || null,
      razorpayPlanId,
      popular,
      isActive,
      createdAt: now,
      updatedAt: now,
    };

    const [createdProduct] = await db
      .insert(products)
      .values(newProduct)
      .returning();

    return reply.status(201).send({
      product: createdProduct,
    });
  } catch (error) {
    console.error('Error creating product:', error);
    return reply.status(500).send({
      error: 'Failed to create product',
      code: 'PRODUCT_CREATE_ERROR',
    });
  }
};

// Update a product
export const updateProduct = async (request: FastifyRequest<{ Params: { id: string }; Body: Partial<Omit<InsertProduct, 'id' | 'createdAt'>> }>, reply: FastifyReply) => {
  try {

    const { id } = request.params;
    const { name, description, frequency, price, razorpayPlanId, popular, isActive } = request.body;

    // Check if product exists
    const existingProduct = await db
      .select()
      .from(products)
      .where(eq(products.id, id))
      .limit(1);

    if (existingProduct.length === 0) {
      return reply.status(404).send({
        error: 'Product not found',
        code: 'PRODUCT_NOT_FOUND',
      });
    }

    const updateData: Partial<InsertProduct> = {
      updatedAt: new Date(),
    };

    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (frequency !== undefined) {
      if (!['monthly', 'yearly'].includes(frequency)) {
        return reply.status(400).send({
          error: 'Frequency must be monthly or yearly',
          code: 'INVALID_FREQUENCY',
        });
      }
      updateData.frequency = frequency as 'monthly' | 'yearly';
    }
    if (price !== undefined) updateData.price = price?.toString() || null;
    if (razorpayPlanId !== undefined) updateData.razorpayPlanId = razorpayPlanId;
    if (popular !== undefined) updateData.popular = popular;
    if (isActive !== undefined) updateData.isActive = isActive;

    const [updatedProduct] = await db
      .update(products)
      .set(updateData)
      .where(eq(products.id, id))
      .returning();

    return reply.send({
      product: updatedProduct,
    });
  } catch (error) {
    console.error('Error updating product:', error);
    return reply.status(500).send({
      error: 'Failed to update product',
      code: 'PRODUCT_UPDATE_ERROR',
    });
  }
};

// Delete a product
export const deleteProduct = async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
  try {

    const { id } = request.params;

    // Check if product exists
    const existingProduct = await db
      .select()
      .from(products)
      .where(eq(products.id, id))
      .limit(1);

    if (existingProduct.length === 0) {
      return reply.status(404).send({
        error: 'Product not found',
        code: 'PRODUCT_NOT_FOUND',
      });
    }

    // Delete product (this will cascade delete benefits due to foreign key constraint)
    await db
      .delete(products)
      .where(eq(products.id, id));

    return reply.send({
      message: 'Product deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting product:', error);
    return reply.status(500).send({
      error: 'Failed to delete product',
      code: 'PRODUCT_DELETE_ERROR',
    });
  }
};

// Add benefit to product
export const addProductBenefit = async (request: FastifyRequest<{ Params: { id: string }; Body: Omit<InsertProductBenefit, 'id' | 'productId' | 'createdAt' | 'updatedAt'> }>, reply: FastifyReply) => {
  try {

    const { id } = request.params;
    const { title, description, icon, order = 0, isActive = true } = request.body;

    if (!title) {
      return reply.status(400).send({
        error: 'Title is required',
        code: 'INVALID_INPUT',
      });
    }

    // Check if product exists
    const existingProduct = await db
      .select()
      .from(products)
      .where(eq(products.id, id))
      .limit(1);

    if (existingProduct.length === 0) {
      return reply.status(404).send({
        error: 'Product not found',
        code: 'PRODUCT_NOT_FOUND',
      });
    }

    const benefitId = generateId();
    const now = new Date();

    const newBenefit: InsertProductBenefit = {
      id: benefitId,
      productId: id,
      title,
      description: description || null,
      icon: icon || null,
      order,
      isActive,
      createdAt: now,
      updatedAt: now,
    };

    const [createdBenefit] = await db
      .insert(productBenefits)
      .values(newBenefit)
      .returning();

    return reply.status(201).send({
      benefit: createdBenefit,
    });
  } catch (error) {
    console.error('Error adding product benefit:', error);
    return reply.status(500).send({
      error: 'Failed to add product benefit',
      code: 'BENEFIT_CREATE_ERROR',
    });
  }
};

// Update product benefit
export const updateProductBenefit = async (request: FastifyRequest<{ Params: { id: string; benefitId: string }; Body: Partial<Omit<InsertProductBenefit, 'id' | 'productId' | 'createdAt'>> }>, reply: FastifyReply) => {
  try {

    const { id, benefitId } = request.params;
    const { title, description, icon, order, isActive } = request.body;

    // Check if benefit exists and belongs to the product
    const existingBenefit = await db
      .select()
      .from(productBenefits)
      .where(and(eq(productBenefits.id, benefitId), eq(productBenefits.productId, id)))
      .limit(1);

    if (existingBenefit.length === 0) {
      return reply.status(404).send({
        error: 'Benefit not found',
        code: 'BENEFIT_NOT_FOUND',
      });
    }

    const updateData: Partial<InsertProductBenefit> = {
      updatedAt: new Date(),
    };

    if (title !== undefined) updateData.title = title;
    if (description !== undefined) updateData.description = description;
    if (icon !== undefined) updateData.icon = icon;
    if (order !== undefined) updateData.order = order;
    if (isActive !== undefined) updateData.isActive = isActive;

    const [updatedBenefit] = await db
      .update(productBenefits)
      .set(updateData)
      .where(eq(productBenefits.id, benefitId))
      .returning();

    return reply.send({
      benefit: updatedBenefit,
    });
  } catch (error) {
    console.error('Error updating product benefit:', error);
    return reply.status(500).send({
      error: 'Failed to update product benefit',
      code: 'BENEFIT_UPDATE_ERROR',
    });
  }
};

// Delete product benefit
export const deleteProductBenefit = async (request: FastifyRequest<{ Params: { id: string; benefitId: string } }>, reply: FastifyReply) => {
  try {

    const { id, benefitId } = request.params;

    // Check if benefit exists and belongs to the product
    const existingBenefit = await db
      .select()
      .from(productBenefits)
      .where(and(eq(productBenefits.id, benefitId), eq(productBenefits.productId, id)))
      .limit(1);

    if (existingBenefit.length === 0) {
      return reply.status(404).send({
        error: 'Benefit not found',
        code: 'BENEFIT_NOT_FOUND',
      });
    }

    await db
      .delete(productBenefits)
      .where(eq(productBenefits.id, benefitId));

    return reply.send({
      message: 'Benefit deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting product benefit:', error);
    return reply.status(500).send({
      error: 'Failed to delete product benefit',
      code: 'BENEFIT_DELETE_ERROR',
    });
  }
};

// Get product with assigned benefits
export const getProductWithBenefits = async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
  try {
    const { id } = request.params;

    // Get product
    const product = await db
      .select()
      .from(products)
      .where(eq(products.id, id))
      .limit(1);

    if (product.length === 0) {
      return reply.status(404).send({
        error: 'Product not found',
        code: 'PRODUCT_NOT_FOUND',
      });
    }

    // Get assigned benefits with their meters
    const assignedBenefits = await db
      .select({
        assignmentId: productBenefitsAssignment.id,
        isActive: productBenefitsAssignment.isActive,
        benefit: {
          id: benefits.id,
          name: benefits.name,
          type: benefits.type,
          creditedUnits: benefits.creditedUnits,
        },
        meter: {
          id: meters.id,
          name: meters.name,
          aggregation: meters.aggregation,
        },
      })
      .from(productBenefitsAssignment)
      .leftJoin(benefits, eq(productBenefitsAssignment.benefitId, benefits.id))
      .leftJoin(meters, eq(benefits.meterId, meters.id))
      .where(eq(productBenefitsAssignment.productId, id));

    return reply.send({
      product: product[0],
      assignedBenefits,
    });
  } catch (error) {
    console.error('Error getting product with benefits:', error);
    return reply.status(500).send({
      error: 'Failed to get product with benefits',
      code: 'PRODUCT_BENEFITS_GET_ERROR',
    });
  }
};

// Assign benefit to product
export const assignBenefitToProduct = async (request: FastifyRequest<{ Params: { id: string }; Body: { benefitId: string } }>, reply: FastifyReply) => {
  try {
    const { id } = request.params;
    const { benefitId } = request.body;

    if (!benefitId) {
      return reply.status(400).send({
        error: 'Benefit ID is required',
        code: 'INVALID_INPUT',
      });
    }

    // Check if product exists
    const existingProduct = await db
      .select()
      .from(products)
      .where(eq(products.id, id))
      .limit(1);

    if (existingProduct.length === 0) {
      return reply.status(404).send({
        error: 'Product not found',
        code: 'PRODUCT_NOT_FOUND',
      });
    }

    // Check if benefit exists
    const existingBenefit = await db
      .select()
      .from(benefits)
      .where(eq(benefits.id, benefitId))
      .limit(1);

    if (existingBenefit.length === 0) {
      return reply.status(404).send({
        error: 'Benefit not found',
        code: 'BENEFIT_NOT_FOUND',
      });
    }

    // Check if assignment already exists
    const existingAssignment = await db
      .select()
      .from(productBenefitsAssignment)
      .where(and(
        eq(productBenefitsAssignment.productId, id),
        eq(productBenefitsAssignment.benefitId, benefitId)
      ))
      .limit(1);

    if (existingAssignment.length > 0) {
      return reply.status(400).send({
        error: 'Benefit already assigned to this product',
        code: 'BENEFIT_ALREADY_ASSIGNED',
      });
    }

    const assignmentId = generateId();
    const now = new Date();

    const newAssignment: InsertProductBenefitsAssignment = {
      id: assignmentId,
      productId: id,
      benefitId,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };

    const [createdAssignment] = await db
      .insert(productBenefitsAssignment)
      .values(newAssignment)
      .returning();

    return reply.status(201).send({
      assignment: createdAssignment,
    });
  } catch (error) {
    console.error('Error assigning benefit to product:', error);
    return reply.status(500).send({
      error: 'Failed to assign benefit to product',
      code: 'BENEFIT_ASSIGNMENT_ERROR',
    });
  }
};

// Remove benefit from product
export const removeBenefitFromProduct = async (request: FastifyRequest<{ Params: { id: string; assignmentId: string } }>, reply: FastifyReply) => {
  try {
    const { id, assignmentId } = request.params;

    // Check if assignment exists and belongs to the product
    const existingAssignment = await db
      .select()
      .from(productBenefitsAssignment)
      .where(and(
        eq(productBenefitsAssignment.id, assignmentId),
        eq(productBenefitsAssignment.productId, id)
      ))
      .limit(1);

    if (existingAssignment.length === 0) {
      return reply.status(404).send({
        error: 'Benefit assignment not found',
        code: 'ASSIGNMENT_NOT_FOUND',
      });
    }

    await db
      .delete(productBenefitsAssignment)
      .where(eq(productBenefitsAssignment.id, assignmentId));

    return reply.send({
      message: 'Benefit removed from product successfully',
    });
  } catch (error) {
    console.error('Error removing benefit from product:', error);
    return reply.status(500).send({
      error: 'Failed to remove benefit from product',
      code: 'BENEFIT_REMOVAL_ERROR',
    });
  }
};