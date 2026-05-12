import type { FastifyPluginAsync } from 'fastify';
import { listOrganizations, getOrganization, createOrganization } from './service';
import type { OrganizationItem, CreateOrganizationBody } from './types';

const orgSchema = {
  type: 'object',
  properties: {
    id:        { type: 'string' },
    name:      { type: 'string' },
    slug:      { type: 'string' },
    createdAt: { type: 'string' },
  },
};

const organizationRoutes: FastifyPluginAsync = async (server) => {
  server.get<{ Reply: { organizations: OrganizationItem[] } }>('/', {
    onRequest: [server.authenticate],
    schema: {
      tags: ['Organizations'],
      summary: 'List all organizations',
      response: {
        200: {
          type: 'object',
          properties: { organizations: { type: 'array', items: orgSchema } },
        },
      },
    },
  }, async (_request, reply) => {
    const organizations = await listOrganizations(server.prisma);
    return reply.send({ organizations });
  });

  server.get<{ Params: { id: string }; Reply: OrganizationItem }>('/:id', {
    onRequest: [server.authenticate],
    schema: {
      tags: ['Organizations'],
      summary: 'Get an organization by ID',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      response: { 200: orgSchema },
    },
  }, async (request, reply) => {
    try {
      const org = await getOrganization(request.params.id, server.prisma);
      return reply.send(org);
    } catch (err) {
      if (err instanceof Error && (err as NodeJS.ErrnoException & { code?: string }).code === 'NOT_FOUND') {
        return reply.notFound(err.message);
      }
      throw err;
    }
  });

  server.post<{ Body: CreateOrganizationBody; Reply: OrganizationItem }>('/', {
    onRequest: [server.authenticate],
    schema: {
      tags: ['Organizations'],
      summary: 'Create a new organization',
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string' },
          slug: { type: 'string', description: 'URL-safe slug; auto-derived from name if omitted' },
        },
      },
      response: { 201: orgSchema },
    },
  }, async (request, reply) => {
    try {
      const org = await createOrganization(request.body, server.prisma);
      return reply.code(201).send(org);
    } catch (err) {
      if (err instanceof Error && (err as NodeJS.ErrnoException & { code?: string }).code === 'CONFLICT') {
        return reply.conflict(err.message);
      }
      throw err;
    }
  });
};

export default organizationRoutes;
