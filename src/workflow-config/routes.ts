import { FastifyPluginAsync } from 'fastify';
import { listWorkflowConfigs, setWorkflowMode, resetWorkflowMode } from './service';
import type { WorkflowConfigItem, SetWorkflowModeBody } from './types';

const workflowConfigItemSchema = {
  type: 'object',
  properties: {
    workflow:   { type: 'string' },
    mode:       { type: 'string', enum: ['checkpoints', 'agent_skill'] },
    isDefault:  { type: 'boolean' },
    updatedAt:  { type: 'string', nullable: true },
  },
};

const workflowConfigRoutes: FastifyPluginAsync = async (server) => {
  // GET /api/v1/workflow-config — list mode for all supported workflows for the caller's org
  server.get<{ Reply: { configs: WorkflowConfigItem[] } }>('/', {
    onRequest: [server.authenticate],
    schema: {
      tags: ['Workflow Config'],
      summary: 'List workflow mode config for the authenticated organization',
      response: {
        200: {
          type: 'object',
          properties: {
            configs: { type: 'array', items: workflowConfigItemSchema },
          },
        },
      },
    },
  }, async (request, reply) => {
    const orgId = request.user.organizationId || null;
    const configs = await listWorkflowConfigs(server.prisma, orgId);
    return reply.send({ configs });
  });

  // PUT /api/v1/workflow-config/:workflow — set mode for a workflow
  server.put<{
    Params: { workflow: string };
    Body: SetWorkflowModeBody;
    Reply: WorkflowConfigItem;
  }>('/:workflow', {
    onRequest: [server.authenticate],
    schema: {
      tags: ['Workflow Config'],
      summary: 'Set the execution mode (checkpoints or agent_skill) for a workflow',
      params: {
        type: 'object',
        properties: { workflow: { type: 'string' } },
        required: ['workflow'],
      },
      body: {
        type: 'object',
        required: ['mode'],
        properties: {
          mode: {
            type: 'string',
            enum: ['checkpoints', 'agent_skill'],
            description: '"checkpoints" runs the deterministic risk engine; "agent_skill" delegates to an LLM following SME instructions',
          },
        },
      },
      response: { 200: workflowConfigItemSchema },
    },
  }, async (request, reply) => {
    const orgId = request.user.organizationId;
    if (!orgId) return reply.badRequest('User must belong to an organization to configure workflow modes');

    try {
      const result = await setWorkflowMode(server.prisma, orgId, request.params.workflow, request.body.mode);
      return reply.send(result);
    } catch (err) {
      if (err instanceof Error && (err as NodeJS.ErrnoException & { code?: string }).code === 'NOT_FOUND') {
        return reply.notFound(err.message);
      }
      throw err;
    }
  });

  // DELETE /api/v1/workflow-config/:workflow — reset to default (CHECKPOINTS)
  server.delete<{ Params: { workflow: string }; Reply: WorkflowConfigItem }>('/:workflow', {
    onRequest: [server.authenticate],
    schema: {
      tags: ['Workflow Config'],
      summary: 'Reset workflow mode back to the default (checkpoints)',
      params: {
        type: 'object',
        properties: { workflow: { type: 'string' } },
        required: ['workflow'],
      },
      response: { 200: workflowConfigItemSchema },
    },
  }, async (request, reply) => {
    const orgId = request.user.organizationId;
    if (!orgId) return reply.badRequest('User must belong to an organization to reset workflow config');

    try {
      const result = await resetWorkflowMode(server.prisma, orgId, request.params.workflow);
      return reply.send(result);
    } catch (err) {
      if (err instanceof Error && (err as NodeJS.ErrnoException & { code?: string }).code === 'NOT_FOUND') {
        return reply.notFound(err.message);
      }
      throw err;
    }
  });
};

export default workflowConfigRoutes;
