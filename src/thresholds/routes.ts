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
    updatedAt:    { type: 'string' },
    isDefault:    { type: 'boolean' },
  },
};

const thresholdRoutes: FastifyPluginAsync = async (server) => {
  // GET /api/v1/thresholds — all effective thresholds (DB overrides + defaults)
  server.get<{ Reply: { thresholds: ThresholdConfigItem[] } }>('/', {
    schema: {
      tags: ['Thresholds'],
      summary: 'List all effective thresholds across all workflows',
      response: {
        200: {
          type: 'object',
          properties: {
            thresholds: { type: 'array', items: thresholdItemSchema },
          },
        },
      },
    },
  }, async (_request, reply) => {
    const thresholds = await listAllThresholds(server.prisma);
    return reply.send({ thresholds });
  });

  // GET /api/v1/thresholds/:workflow — thresholds for a specific workflow
  server.get<{ Params: { workflow: string }; Reply: { thresholds: ThresholdConfigItem[] } }>('/:workflow', {
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
    const thresholds = await listWorkflowThresholds(request.params.workflow, server.prisma);
    return reply.send({ thresholds });
  });

  // PUT /api/v1/thresholds/:workflow/:checkpoint — create or update a threshold
  server.put<{
    Params: { workflow: string; checkpoint: string };
    Body: UpsertThresholdBody;
    Reply: ThresholdConfigItem;
  }>('/:workflow/:checkpoint', {
    schema: {
      tags: ['Thresholds'],
      summary: 'Create or update a threshold for a workflow checkpoint',
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
        },
      },
      response: { 200: thresholdItemSchema },
    },
  }, async (request, reply) => {
    try {
      const { workflow, checkpoint } = request.params;
      const { greenMax, amberMax } = request.body;
      const result = await upsertThreshold(workflow, checkpoint, greenMax, amberMax, server.prisma);
      return reply.send(result);
    } catch (err) {
      if (err instanceof Error && (err as NodeJS.ErrnoException & { code?: string }).code === 'VALIDATION') {
        return reply.badRequest(err.message);
      }
      throw err;
    }
  });

  // DELETE /api/v1/thresholds/:workflow/:checkpoint — reset to coded default
  server.delete<{ Params: { workflow: string; checkpoint: string }; Reply: ThresholdConfigItem }>('/:workflow/:checkpoint', {
    schema: {
      tags: ['Thresholds'],
      summary: 'Reset a threshold back to its coded default',
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
      const result = await resetThreshold(workflow, checkpoint, server.prisma);
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
