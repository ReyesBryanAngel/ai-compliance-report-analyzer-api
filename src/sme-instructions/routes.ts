import { FastifyPluginAsync } from 'fastify';
import {
  listInstructionVersions,
  createInstructionVersion,
  activateInstructionVersion,
  deleteInstructionVersion,
  resolveEffectiveInstruction,
} from './service';
import type { InstructionItem, CreateInstructionBody } from './types';

const instructionItemSchema = {
  type: 'object',
  properties: {
    id:        { type: 'string' },
    workflow:  { type: 'string' },
    scope:     { type: 'string', enum: ['org', 'global'] },
    version:   { type: 'number' },
    title:     { type: 'string', nullable: true },
    content:   { type: 'string' },
    isActive:  { type: 'boolean' },
    createdBy: {
      type: 'object',
      nullable: true,
      properties: {
        id:    { type: 'string' },
        name:  { type: 'string', nullable: true },
        email: { type: 'string' },
      },
    },
    createdAt: { type: 'string' },
    updatedAt: { type: 'string' },
  },
};

type ServiceErrorCode = Error & { code?: string };

function getCode(err: unknown): string | undefined {
  return err instanceof Error ? (err as ServiceErrorCode).code : undefined;
}

const smeInstructionRoutes: FastifyPluginAsync = async (server) => {
  // GET /api/v1/workflows/:workflow/instructions — list org + global versions
  server.get<{
    Params: { workflow: string };
    Reply: { instructions: InstructionItem[] };
  }>('/:workflow/instructions', {
    onRequest: [server.authenticate],
    schema: {
      tags: ['SME Instructions'],
      summary: 'List all instruction versions visible to the organization (org-specific + global)',
      params: {
        type: 'object',
        properties: { workflow: { type: 'string' } },
        required: ['workflow'],
      },
      response: {
        200: {
          type: 'object',
          properties: { instructions: { type: 'array', items: instructionItemSchema } },
        },
      },
    },
  }, async (request, reply) => {
    const orgId = request.user.organizationId || null;
    try {
      const instructions = await listInstructionVersions(server.prisma, request.params.workflow, orgId);
      return reply.send({ instructions });
    } catch (err) {
      if (getCode(err) === 'NOT_FOUND') return reply.notFound((err as Error).message);
      throw err;
    }
  });

  // GET /api/v1/workflows/:workflow/instructions/active — resolve effective active instruction
  server.get<{ Params: { workflow: string } }>('/:workflow/instructions/active', {
    onRequest: [server.authenticate],
    schema: {
      tags: ['SME Instructions'],
      summary: 'Resolve the effective active instruction for a workflow (org override → global → built-in)',
      params: {
        type: 'object',
        properties: { workflow: { type: 'string' } },
        required: ['workflow'],
      },
      response: {
        200: {
          type: 'object',
          properties: {
            source:  { type: 'string', enum: ['org', 'global', 'built-in'] },
            content: { type: 'string' },
            item:    { ...instructionItemSchema, nullable: true },
          },
        },
      },
    },
  }, async (request, reply) => {
    const orgId = request.user.organizationId || null;
    try {
      const result = await resolveEffectiveInstruction(server.prisma, request.params.workflow, orgId);
      return reply.send(result);
    } catch (err) {
      if (getCode(err) === 'NOT_FOUND') return reply.notFound((err as Error).message);
      throw err;
    }
  });

  // POST /api/v1/workflows/:workflow/instructions — create a new org-scoped draft version
  server.post<{
    Params: { workflow: string };
    Body: CreateInstructionBody;
  }>('/:workflow/instructions', {
    onRequest: [server.authenticate],
    schema: {
      tags: ['SME Instructions'],
      summary: 'Create a new org-scoped draft instruction version (isActive: false)',
      params: {
        type: 'object',
        properties: { workflow: { type: 'string' } },
        required: ['workflow'],
      },
      body: {
        type: 'object',
        required: ['content'],
        properties: {
          title:   { type: 'string', description: 'Optional human-readable title for this version' },
          content: { type: 'string', minLength: 1, description: 'SME instruction text sent to the LLM' },
        },
      },
      response: { 201: instructionItemSchema },
    },
  }, async (request, reply) => {
    const orgId = request.user.organizationId;
    if (!orgId) return reply.badRequest('User must belong to an organization to create instructions');

    try {
      const item = await createInstructionVersion(
        server.prisma,
        request.params.workflow,
        orgId,
        request.body,
        request.user.sub,
      );
      return reply.code(201).send(item);
    } catch (err) {
      if (getCode(err) === 'NOT_FOUND') return reply.notFound((err as Error).message);
      throw err;
    }
  });

  // PATCH /api/v1/workflows/:workflow/instructions/:id/activate — activate a version
  server.patch<{ Params: { workflow: string; id: string } }>('/:workflow/instructions/:id/activate', {
    onRequest: [server.authenticate],
    schema: {
      tags: ['SME Instructions'],
      summary: 'Activate an instruction version (deactivates other org versions for this workflow)',
      params: {
        type: 'object',
        properties: {
          workflow: { type: 'string' },
          id:       { type: 'string' },
        },
        required: ['workflow', 'id'],
      },
      response: { 200: instructionItemSchema },
    },
  }, async (request, reply) => {
    const orgId = request.user.organizationId;
    if (!orgId) return reply.badRequest('User must belong to an organization to activate instructions');

    try {
      const item = await activateInstructionVersion(server.prisma, request.params.id, orgId);
      return reply.send(item);
    } catch (err) {
      if (getCode(err) === 'NOT_FOUND') return reply.notFound((err as Error).message);
      throw err;
    }
  });

  // DELETE /api/v1/workflows/:workflow/instructions/:id — delete a non-active draft
  server.delete<{ Params: { workflow: string; id: string } }>('/:workflow/instructions/:id', {
    onRequest: [server.authenticate],
    schema: {
      tags: ['SME Instructions'],
      summary: 'Delete a non-active org instruction draft (409 if currently active)',
      params: {
        type: 'object',
        properties: {
          workflow: { type: 'string' },
          id:       { type: 'string' },
        },
        required: ['workflow', 'id'],
      },
      response: { 204: { type: 'null' } },
    },
  }, async (request, reply) => {
    const orgId = request.user.organizationId;
    if (!orgId) return reply.badRequest('User must belong to an organization to delete instructions');

    try {
      await deleteInstructionVersion(server.prisma, request.params.id, orgId);
      return reply.code(204).send();
    } catch (err) {
      if (getCode(err) === 'NOT_FOUND') return reply.notFound((err as Error).message);
      throw err;
    }
  });
};

export default smeInstructionRoutes;
