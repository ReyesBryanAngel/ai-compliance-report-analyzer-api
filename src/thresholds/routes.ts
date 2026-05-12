import { FastifyPluginAsync } from 'fastify';
import { listAllThresholds, listWorkflowThresholds, upsertThreshold, resetThreshold } from './service';
import type { ThresholdConfigItem, UpsertThresholdBody } from './types';

const thresholdItemSchema = {
  type: 'object',
  properties: {
    id:           { type: 'string' },
    workflow:     { type: 'string' },
    checkpoint:   { type: 'string' },
    checkpointId: { type: 'string' },
    greenMax:     { type: 'number' },
    amberMax:     { type: 'number' },
    params:       { type: 'object', nullable: true, additionalProperties: true },
    updatedAt:    { type: 'string' },
    isDefault:    { type: 'boolean' },
  },
};

const thresholdRoutes: FastifyPluginAsync = async (server) => {
  // GET /api/v1/thresholds — effective thresholds for the caller's org
  server.get<{ Reply: { thresholds: ThresholdConfigItem[] } }>('/', {
    onRequest: [server.authenticate],
    schema: {
      tags: ['Thresholds'],
      summary: 'List all effective thresholds for the authenticated organization',
      response: {
        200: {
          type: 'object',
          properties: {
            thresholds: { type: 'array', items: thresholdItemSchema },
          },
        },
      },
    },
  }, async (request, reply) => {
    const orgId = request.user.organizationId || null;
    const thresholds = await listAllThresholds(server.prisma, orgId);
    return reply.send({ thresholds });
  });

  // GET /api/v1/thresholds/:workflow — thresholds for a specific workflow
  server.get<{ Params: { workflow: string }; Reply: { thresholds: ThresholdConfigItem[] } }>('/:workflow', {
    onRequest: [server.authenticate],
    schema: {
      tags: ['Thresholds'],
      summary: 'List effective thresholds for a specific workflow',
      params: {
        type: 'object',
        properties: { workflow: { type: 'string' } },
        required: ['workflow'],
      },
      response: {
        200: {
          type: 'object',
          properties: {
            thresholds: { type: 'array', items: thresholdItemSchema },
          },
        },
      },
    },
  }, async (request, reply) => {
    const orgId = request.user.organizationId || null;
    const thresholds = await listWorkflowThresholds(request.params.workflow, server.prisma, orgId);
    return reply.send({ thresholds });
  });

  // PUT /api/v1/thresholds/:workflow/:checkpoint — create or update a threshold for the org
  server.put<{
    Params: { workflow: string; checkpoint: string };
    Body: UpsertThresholdBody;
    Reply: ThresholdConfigItem;
  }>('/:workflow/:checkpoint', {
    onRequest: [server.authenticate],
    schema: {
      tags: ['Thresholds'],
      summary: 'Create or update a threshold for the authenticated organization',
      params: {
        type: 'object',
        properties: {
          workflow:   { type: 'string' },
          checkpoint: { type: 'string' },
        },
        required: ['workflow', 'checkpoint'],
      },
      body: {
        type: 'object',
        required: ['greenMax', 'amberMax'],
        properties: {
          greenMax: {
            type: 'integer',
            minimum: 0,
            description: 'Upper bound (inclusive) for GREEN / low-risk rating',
          },
          amberMax: {
            type: 'integer',
            minimum: 1,
            description: 'Upper bound (inclusive) for AMBER / medium-risk rating. Values above this are RED.',
          },
          params: {
            type: 'object',
            additionalProperties: true,
            nullable: true,
            description: 'Checkpoint-specific extra parameters (e.g. windowHours, drainRatio, minInflow for rapid-inflow-outflow)',
          },
        },
      },
      response: { 200: thresholdItemSchema },
    },
  }, async (request, reply) => {
    try {
      const { workflow, checkpoint } = request.params;
      const { greenMax, amberMax, params } = request.body;
      const orgId = request.user.organizationId;
      if (!orgId) return reply.badRequest('User must belong to an organization to configure thresholds');
      const result = await upsertThreshold(workflow, checkpoint, greenMax, amberMax, server.prisma, orgId, params);
      return reply.send(result);
    } catch (err) {
      if (err instanceof Error) {
        const code = (err as NodeJS.ErrnoException & { code?: string }).code;
        if (code === 'VALIDATION') return reply.badRequest(err.message);
        if (code === 'NOT_FOUND') return reply.notFound(err.message);
      }
      throw err;
    }
  });

  // DELETE /api/v1/thresholds/:workflow/:checkpoint — reset org override back to default
  server.delete<{ Params: { workflow: string; checkpoint: string }; Reply: ThresholdConfigItem }>('/:workflow/:checkpoint', {
    onRequest: [server.authenticate],
    schema: {
      tags: ['Thresholds'],
      summary: 'Reset the organization threshold override back to the coded default',
      params: {
        type: 'object',
        properties: {
          workflow:   { type: 'string' },
          checkpoint: { type: 'string' },
        },
        required: ['workflow', 'checkpoint'],
      },
      response: { 200: thresholdItemSchema },
    },
  }, async (request, reply) => {
    try {
      const { workflow, checkpoint } = request.params;
      const orgId = request.user.organizationId;
      if (!orgId) return reply.badRequest('User must belong to an organization to reset thresholds');
      const result = await resetThreshold(workflow, checkpoint, server.prisma, orgId);
      return reply.send(result);
    } catch (err) {
      if (err instanceof Error && (err as NodeJS.ErrnoException & { code?: string }).code === 'NOT_FOUND') {
        return reply.notFound(err.message);
      }
      throw err;
    }
  });
};

export default thresholdRoutes;
