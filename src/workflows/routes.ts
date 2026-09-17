import { FastifyPluginAsync } from 'fastify';
import type { PrismaClient } from '../generated/prisma/client';

interface WorkflowItem {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  enabled: boolean;
}

const workflowSchema = {
  type: 'object',
  properties: {
    id:          { type: 'string' },
    slug:        { type: 'string' },
    name:        { type: 'string' },
    description: { type: 'string', nullable: true },
    enabled:     { type: 'boolean' },
  },
};

async function fetchWorkflows(prisma: PrismaClient): Promise<WorkflowItem[]> {
  const rows = await prisma.workflow.findMany({
    orderBy: { slug: 'asc' },
  });
  return rows.map((wf) => ({
    id: wf.id,
    slug: wf.slug,
    name: wf.name,
    description: wf.description,
    enabled: wf.enabled,
  }));
}

const workflowRoutes: FastifyPluginAsync = async (server) => {
  // GET /api/v1/workflows — list all workflows
  server.get<{ Reply: { workflows: WorkflowItem[] } }>('/', {
    schema: {
      tags: ['Workflows'],
      summary: 'List all workflows',
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

  // GET /api/v1/workflows/:workflow — single workflow
  server.get<{ Params: { workflow: string }; Reply: WorkflowItem }>('/:workflow', {
    schema: {
      tags: ['Workflows'],
      summary: 'Get a workflow by slug',
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
    });
    if (!wf) return reply.notFound(`Workflow '${request.params.workflow}' not found`);
    return reply.send({
      id: wf.id,
      slug: wf.slug,
      name: wf.name,
      description: wf.description,
      enabled: wf.enabled,
    });
  });

};

export default workflowRoutes;
