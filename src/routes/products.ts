import { FastifyPluginAsync } from 'fastify';
import {
  listProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  addProductBenefit,
  updateProductBenefit,
  deleteProductBenefit,
  getProductWithBenefits,
  assignBenefitToProduct,
  removeBenefitFromProduct,
} from '../controllers/productsController';
import { convertHeaders } from '../utils/header';
import { auth } from '../lib/auth';

const productsRoutes: FastifyPluginAsync = async fastify => {
  // Admin products management routes

  // Authentication prehandler for all admin routes
  const adminPrehandler = async (request, reply) => {
    const headers = convertHeaders(request);
    const session = await auth.api.getSession({ headers });
    if (!session?.session) {
      return reply.status(401).send({
        error: 'Authentication required',
        code: 'AUTH_REQUIRED',
      });
    }
    if (session.user.role !== 'admin') {
      return reply.status(403).send({
        error: 'Admin access required',
        code: 'ADMIN_REQUIRED',
      });
    }
  };

  // List all products
  fastify.get(
    '/admin/products',
    {
      preHandler: adminPrehandler,
    },
    listProducts
  );

  // Get a single product with benefits
  fastify.get(
    '/admin/products/:id',
    {
      preHandler: adminPrehandler,
    },
    getProduct
  );

  // Create a new product
  fastify.post(
    '/admin/products',
    {
      preHandler: adminPrehandler,
      schema: {
        body: {
          type: 'object',
          required: ['name', 'frequency'],
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 100 },
            description: { type: 'string' },
            frequency: { type: 'string', enum: ['monthly', 'yearly'] },
            type: { type: 'string', enum: ['fixed'] },
            price: { type: 'number', minimum: 0 },
            isActive: { type: 'boolean' },
          },
        },
      },
    },
    createProduct
  );

  // Update a product
  fastify.put(
    '/admin/products/:id',
    {
      preHandler: adminPrehandler,
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string' },
          },
        },
        body: {
          type: 'object',
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 100 },
            description: { type: 'string' },
            frequency: { type: 'string', enum: ['monthly', 'yearly'] },
            price: { type: 'number', minimum: 0 },
            isActive: { type: 'boolean' },
          },
        },
      },
    },
    updateProduct
  );

  // Delete a product
  fastify.delete(
    '/admin/products/:id',
    {
      preHandler: adminPrehandler,
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string' },
          },
        },
      },
    },
    deleteProduct
  );

  // Product benefits management

  // Add benefit to product
  fastify.post(
    '/admin/products/:id/benefits',
    {
      preHandler: adminPrehandler,
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string' },
          },
        },
        body: {
          type: 'object',
          required: ['title'],
          properties: {
            title: { type: 'string', minLength: 1 },
            description: { type: 'string' },
            icon: { type: 'string' },
            order: { type: 'integer', minimum: 0 },
            isActive: { type: 'boolean' },
          },
        },
      },
    },
    addProductBenefit
  );

  // Update product benefit
  fastify.put(
    '/admin/products/:id/benefits/:benefitId',
    {
      preHandler: adminPrehandler,
      schema: {
        params: {
          type: 'object',
          required: ['id', 'benefitId'],
          properties: {
            id: { type: 'string' },
            benefitId: { type: 'string' },
          },
        },
        body: {
          type: 'object',
          properties: {
            title: { type: 'string', minLength: 1 },
            description: { type: 'string' },
            icon: { type: 'string' },
            order: { type: 'integer', minimum: 0 },
            isActive: { type: 'boolean' },
          },
        },
      },
    },
    updateProductBenefit
  );

  // Delete product benefit
  fastify.delete(
    '/admin/products/:id/benefits/:benefitId',
    {
      preHandler: adminPrehandler,
      schema: {
        params: {
          type: 'object',
          required: ['id', 'benefitId'],
          properties: {
            id: { type: 'string' },
            benefitId: { type: 'string' },
          },
        },
      },
    },
    deleteProductBenefit
  );

  // Benefits Assignment Management

  // Get product with assigned benefits
  fastify.get(
    '/admin/products/:id/assigned-benefits',
    {
      preHandler: adminPrehandler,
    },
    getProductWithBenefits
  );

  // Assign benefit to product
  fastify.post(
    '/admin/products/:id/assign-benefit',
    {
      preHandler: adminPrehandler,
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string' },
          },
        },
        body: {
          type: 'object',
          required: ['benefitId'],
          properties: {
            benefitId: { type: 'string' },
          },
        },
      },
    },
    assignBenefitToProduct
  );

  // Remove benefit from product
  fastify.delete(
    '/admin/products/:id/assigned-benefits/:assignmentId',
    {
      preHandler: adminPrehandler,
      schema: {
        params: {
          type: 'object',
          required: ['id', 'assignmentId'],
          properties: {
            id: { type: 'string' },
            assignmentId: { type: 'string' },
          },
        },
      },
    },
    removeBenefitFromProduct
  );
};

export default productsRoutes;
