import type { FastifyPluginAsync } from 'fastify';
import {
  listWorkflowExecutions,
  listReportExecutions,
  getWorkflowExecution,
  getWorkflowExecutionConversation,
  getAgentExecution,
} from './service';
import type { ExecutionFilters } from './types';

const executionSummarySchema = {
  type: 'object',
  properties: {
    id:           { type: 'string' },
    reportId:     { type: 'string' },
    workflowSlug: { type: 'string' },
    mode:         { type: 'string', enum: ['CHECKPOINTS', 'AGENT_SKILL'] },
    status:       { type: 'string', enum: ['RUNNING', 'COMPLETED', 'FAILED'] },
    overallScore: { type: 'number', nullable: true },
    error:        { type: 'string', nullable: true },
    startedAt:    { type: 'string' },
    completedAt:  { type: 'string', nullable: true },
  },
};

const messageSchema = {
  type: 'object',
  properties: {
    id:        { type: 'string' },
    role:      { type: 'string', enum: ['SYSTEM', 'USER', 'ASSISTANT'] },
    content:   { type: 'string' },
    sequence:  { type: 'number' },
    createdAt: { type: 'string' },
  },
};

const agentExecutionDetailSchema = {
  type: 'object',
  properties: {
    id:               { type: 'string' },
    skillSlug:        { type: 'string' },
    provider:         { type: 'string' },
    model:            { type: 'string' },
    sequence:         { type: 'number' },
    status:           { type: 'string', enum: ['RUNNING', 'COMPLETED', 'FAILED'] },
    promptTokens:     { type: 'number', nullable: true },
    completionTokens: { type: 'number', nullable: true },
    latencyMs:        { type: 'number', nullable: true },
    error:            { type: 'string', nullable: true },
    messages:         { type: 'array', items: messageSchema },
    startedAt:        { type: 'string' },
    completedAt:      { type: 'string', nullable: true },
  },
};

const conversationDetailSchema = {
  type: 'object',
  properties: {
    id:                  { type: 'string' },
    workflowExecutionId: { type: 'string' },
    executions:          { type: 'array', items: agentExecutionDetailSchema },
  },
};

type ErrWithCode = Error & { code?: string };

function getCode(err: unknown): string | undefined {
  return err instanceof Error ? (err as ErrWithCode).code : undefined;
}

const workflowExecutionRoutes: FastifyPluginAsync = async (server) => {
  // GET /api/v1/reports/:id/workflow-executions — all executions for a specific report
  server.get<{
    Params: { id: string };
  }>('/reports/:id/workflow-executions', {
    onRequest: [server.authenticate],
    schema: {
      tags: ['Workflow Executions'],
      summary: 'List all workflow executions for a specific report',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      response: {
        200: {
          type: 'object',
          properties: {
            executions: { type: 'array', items: executionSummarySchema },
          },
        },
      },
    },
  }, async (request, reply) => {
    const orgId = request.user.organizationId || null;
    try {
      const executions = await listReportExecutions(server.prisma, orgId, request.params.id);
      return reply.send({ executions });
    } catch (err) {
      if (getCode(err) === 'NOT_FOUND') return reply.notFound((err as Error).message);
      throw err;
    }
  });

  // GET /api/v1/workflow-executions — org-wide list, filterable + cursor-paginated
  server.get<{
    Querystring: {
      status?: string;
      workflowSlug?: string;
      mode?: string;
      reportId?: string;
      from?: string;
      to?: string;
      cursor?: string;
      limit?: number;
    };
  }>('/workflow-executions', {
    onRequest: [server.authenticate],
    schema: {
      tags: ['Workflow Executions'],
      summary: 'List workflow executions org-wide with optional filters and cursor pagination',
      querystring: {
        type: 'object',
        properties: {
          status:       { type: 'string', enum: ['RUNNING', 'COMPLETED', 'FAILED'] },
          workflowSlug: { type: 'string' },
          mode:         { type: 'string', enum: ['CHECKPOINTS', 'AGENT_SKILL'] },
          reportId:     { type: 'string' },
          from:         { type: 'string', description: 'ISO 8601 lower bound on startedAt' },
          to:           { type: 'string', description: 'ISO 8601 upper bound on startedAt' },
          cursor:       { type: 'string', description: 'Opaque pagination cursor from previous response' },
          limit:        { type: 'number', minimum: 1, maximum: 100, default: 20 },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            items:      { type: 'array', items: executionSummarySchema },
            nextCursor: { type: 'string', nullable: true },
          },
        },
      },
    },
  }, async (request, reply) => {
    const orgId = request.user.organizationId || null;
    const { status, workflowSlug, mode, reportId, from, to, cursor, limit } = request.query;

    const filters: ExecutionFilters = {
      ...(status ? { status: status as ExecutionFilters['status'] } : {}),
      ...(workflowSlug ? { workflowSlug } : {}),
      ...(mode ? { mode: mode as ExecutionFilters['mode'] } : {}),
      ...(reportId ? { reportId } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      ...(cursor ? { cursor } : {}),
      ...(limit ? { limit } : {}),
    };

    const page = await listWorkflowExecutions(server.prisma, orgId, filters);
    return reply.send(page);
  });

  // GET /api/v1/workflow-executions/:id — single execution summary
  server.get<{ Params: { id: string } }>('/workflow-executions/:id', {
    onRequest: [server.authenticate],
    schema: {
      tags: ['Workflow Executions'],
      summary: 'Get a single workflow execution summary',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      response: { 200: executionSummarySchema },
    },
  }, async (request, reply) => {
    const orgId = request.user.organizationId || null;
    try {
      const execution = await getWorkflowExecution(server.prisma, orgId, request.params.id);
      return reply.send(execution);
    } catch (err) {
      if (getCode(err) === 'NOT_FOUND') return reply.notFound((err as Error).message);
      throw err;
    }
  });

  // GET /api/v1/workflow-executions/:id/conversation — full message log
  server.get<{ Params: { id: string } }>('/workflow-executions/:id/conversation', {
    onRequest: [server.authenticate],
    schema: {
      tags: ['Workflow Executions'],
      summary: 'Get the full agent conversation log for a workflow execution',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      response: { 200: conversationDetailSchema },
    },
  }, async (request, reply) => {
    const orgId = request.user.organizationId || null;
    try {
      const conversation = await getWorkflowExecutionConversation(
        server.prisma,
        orgId,
        request.params.id,
      );
      return reply.send(conversation);
    } catch (err) {
      if (getCode(err) === 'NOT_FOUND') return reply.notFound((err as Error).message);
      throw err;
    }
  });

  // GET /api/v1/agent-executions/:id — single agent execution with messages
  server.get<{ Params: { id: string } }>('/agent-executions/:id', {
    onRequest: [server.authenticate],
    schema: {
      tags: ['Workflow Executions'],
      summary: 'Get a single agent execution with its message log',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      response: { 200: agentExecutionDetailSchema },
    },
  }, async (request, reply) => {
    const orgId = request.user.organizationId || null;
    try {
      const execution = await getAgentExecution(server.prisma, orgId, request.params.id);
      return reply.send(execution);
    } catch (err) {
      if (getCode(err) === 'NOT_FOUND') return reply.notFound((err as Error).message);
      throw err;
    }
  });
};

export default workflowExecutionRoutes;
