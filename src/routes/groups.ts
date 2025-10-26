import { FastifyInstance } from 'fastify';
import { groupsController } from '../controllers/groupsController';

export default async function groupRoutes(fastify: FastifyInstance) {
  // Get all groups
  fastify.get('/', groupsController.getGroups);

  // Get single group with members
  fastify.get('/:id', groupsController.getGroup);

  // Create new group
  fastify.post('/', groupsController.createGroup);

  // Update group
  fastify.put('/:id', groupsController.updateGroup);

  // Delete group
  fastify.delete('/:id', groupsController.deleteGroup);

  // Add contacts to group
  fastify.post('/:id/add-contacts', groupsController.addContactsToGroup);

  // Remove contacts from group
  fastify.post('/:id/remove-contacts', groupsController.removeContactsFromGroup);
}
