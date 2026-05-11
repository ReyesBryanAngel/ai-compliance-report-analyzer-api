import { FastifyPluginAsync } from 'fastify';
import type { PrismaClient } from '../generated/prisma/client';

interface CheckpointItem {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  enabled: boolean;
}

interface WorkflowItem {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  enabled: boolean;
  checkpoints: CheckpointItem[];
}

const checkpointSchema = {
  type: 'object',
  properties: {
    id:          { type: 'string' },
    slug:        { type: 'string' },
    name:        { type: 'string' },
    description: { type: 'string', nullable: true },
    enabled:     { type: 'boolean' },
  },
};

const workflowSchema = {
  type: 'object',
  properties: {
    id:          { type: 'string' },
    slug:        { type: 'string' },
    name:        { type: 'string' },
    description: { type: 'string', nullable: true },
    enabled:     { type: 'boolean' },
    checkpoints: { type: 'array', items: checkpointSchema },
  },
};

async function fetchWorkflows(prisma: PrismaClient): Promise<WorkflowItem[]> {
  const rows = await prisma.workflow.findMany({
    include: { checkpoints: { orderBy: { slug: 'asc' } } },
    orderBy: { slug: 'asc' },
  });
  return rows.map((wf) => ({
    id: wf.id,
    slug: wf.slug,
    name: wf.name,
    description: wf.description,
    enabled: wf.enabled,
    checkpoints: wf.checkpoints.map((cp) => ({
      id: cp.id,
      slug: cp.slug,
      name: cp.name,
      description: cp.description,
      enabled: cp.enabled,
    })),
  }));
}

const workflowRoutes: FastifyPluginAsync = async (server) => {
  // GET /api/v1/workflows — list all workflows with their checkpoints
  server.get<{ Reply: { workflows: WorkflowItem[] } }>('/', {
    schema: {
      tags: ['Workflows'],
      summary: 'List all workflows and their checkpoints',
      response: {
        200: {
          type: 'object',
          properties: {
            workflows: { type: 'array', items: workflowSchema },
          },
        },
      },
    },
  }, async (_request, reply) => {
    const workflows = await fetchWorkflows(server.prisma);
    return reply.send({ workflows });
  });

  // GET /api/v1/workflows/:workflow — single workflow with checkpoints
  server.get<{ Params: { workflow: string }; Reply: WorkflowItem }>('/:workflow', {
    schema: {
      tags: ['Workflows'],
      summary: 'Get a workflow and its checkpoints by slug',
      params: {
        type: 'object',
        properties: { workflow: { type: 'string' } },
        required: ['workflow'],
      },
      response: { 200: workflowSchema },
    },
  }, async (request, reply) => {
    const wf = await server.prisma.workflow.findUnique({
      where: { slug: request.params.workflow },
      include: { checkpoints: { orderBy: { slug: 'asc' } } },
    });
    if (!wf) return reply.notFound(`Workflow '${request.params.workflow}' not found`);
    return reply.send({
      id: wf.id,
      slug: wf.slug,
      name: wf.name,
      description: wf.description,
      enabled: wf.enabled,
      checkpoints: wf.checkpoints.map((cp) => ({
        id: cp.id,
        slug: cp.slug,
        name: cp.name,
        description: cp.description,
        enabled: cp.enabled,
      })),
    });
  });

  // PATCH /api/v1/workflows/:workflow/checkpoints/:checkpoint — toggle checkpoint enabled/disabled
  server.patch<{
    Params: { workflow: string; checkpoint: string };
    Body: { enabled: boolean };
    Reply: CheckpointItem;
  }>('/:workflow/checkpoints/:checkpoint', {
    schema: {
      tags: ['Workflows'],
      summary: 'Enable or disable a checkpoint within a workflow',
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
        required: ['enabled'],
        properties: {
          enabled: { type: 'boolean', description: 'Set to false to disable this checkpoint' },
        },
      },
      response: { 200: checkpointSchema },
    },
  }, async (request, reply) => {
    const { workflow: workflowSlug, checkpoint: checkpointSlug } = request.params;
    const { enabled } = request.body;

    const cp = await server.prisma.checkpoint.findFirst({
      where: { slug: checkpointSlug, workflow: { slug: workflowSlug } },
    });
    if (!cp) {
      return reply.notFound(`Checkpoint '${checkpointSlug}' not found in workflow '${workflowSlug}'`);
    }

    const updated = await server.prisma.checkpoint.update({
      where: { id: cp.id },
      data: { enabled },
    });

    return reply.send({
      id: updated.id,
      slug: updated.slug,
      name: updated.name,
      description: updated.description,
      enabled: updated.enabled,
    });
  });
};

export default workflowRoutes;
