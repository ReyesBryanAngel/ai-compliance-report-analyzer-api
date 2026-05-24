import { FastifyPluginAsync } from 'fastify';
import { generateReport, getReport, listReports } from './service';
import { SUPPORTED_WORKFLOWS } from '../risk-engine';
import type { GenerateReportBatchResponse, GenerateReportBody, GenerateReportResponse, ListReportItem } from './types';

const transactionSchema = {
  type: 'object',
  properties: {
    date:        { type: 'string' },
    description: { type: 'string' },
    amount:      { type: 'number' },
    direction:   { type: 'string' },
    balance:     { type: 'number' },
    category:    { type: 'string' },
    channel:     { type: 'string' },
    currency:    { type: 'string' },
    reference:   { type: 'string' },
  },
};

const findingSchema = {
  type: 'object',
  properties: {
    checkpoint: { type: 'string' },
    triggered:  { type: 'boolean' },
    severity:   { type: 'string' },
    score:      { type: 'number' },
    reason:     { type: 'string' },
    evidence:   { type: 'array', items: transactionSchema },
  },
};

const workflowResultSchema = {
  type: 'object',
  properties: {
    workflow:     { type: 'string' },
    overallScore: { type: 'number' },
    findings:     { type: 'array', items: findingSchema },
  },
};

const summarySchema = {
  type: 'object',
  properties: {
    severity:          { type: 'string', enum: ['none', 'low', 'medium', 'high'] },
    totalDocuments:    { type: 'number' },
    totalTransactions: { type: 'number' },
    overallRiskScore:  { type: 'number' },
    triggeredChecks:   { type: 'number' },
    highRiskFindings:  { type: 'number' },
  },
};

const checkSchema = {
  type: 'object',
  properties: {
    id:      { type: 'string' },
    rule:    { type: 'string' },
    passed:  { type: 'boolean' },
    details: { type: 'string', nullable: true },
  },
};

const reportResponseSchema = {
  type: 'object',
  properties: {
    id:          { type: 'string' },
    title:       { type: 'string' },
    status:      { type: 'string' },
    documentIds: { type: 'array', items: { type: 'string' } },
    workflows:   { type: 'array', items: { type: 'string' } },
    results:     { type: 'array', items: workflowResultSchema },
    checks:      { type: 'array', items: checkSchema },
    summary:     summarySchema,
    createdAt:   { type: 'string' },
  },
};

const reportRoutes: FastifyPluginAsync = async (server) => {
  server.post<{ Body: GenerateReportBody; Reply: GenerateReportBatchResponse }>('/generate', {
    onRequest: [server.authenticate],
    schema: {
      tags: ['Reports'],
      summary: 'Generate a compliance report for one or more documents',
      body: {
        type: 'object',
        required: ['workflows'],
        properties: {
          workflows: {
            type: 'array',
            items: { type: 'string', enum: [...SUPPORTED_WORKFLOWS] },
            minItems: 1,
            description: `Workflows to execute. Supported: ${SUPPORTED_WORKFLOWS.join(', ')}`,
          },
          document_ids: {
            type: 'array',
            items: { type: 'string', format: 'uuid' },
            minItems: 1,
            description: 'Explicit document IDs to include in the analysis',
          },
          batch_id: {
            type: 'string',
            format: 'uuid',
            description: 'Batch ID — all documents in this batch will be included',
          },
          title: {
            type: 'string',
            description: 'Optional label for the report',
          },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            reports: { type: 'array', items: reportResponseSchema },
          },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const { sub: userId, organizationId } = request.user;
      const orgId = organizationId || null;
      const result = await generateReport(request.body, server.prisma, userId, orgId);
      return reply.send(result);
    } catch (err) {
      if (err instanceof Error) {
        const code = (err as NodeJS.ErrnoException & { code?: string }).code;
        if (code === 'NOT_FOUND') return reply.notFound(err.message);
        if (code === 'UNSUPPORTED_WORKFLOW' || code === 'UNSUPPORTED_MIME' || code === 'NOT_READY' || code === 'VALIDATION') {
          return reply.badRequest(err.message);
        }
      }
      throw err;
    }
  });

  server.get<{ Params: { id: string }; Reply: GenerateReportResponse }>('/:id', {
    onRequest: [server.authenticate],
    schema: {
      tags: ['Reports'],
      summary: 'Get a compliance report by ID',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      response: { 200: reportResponseSchema },
    },
  }, async (request, reply) => {
    try {
      const orgId = request.user.organizationId || null;
      const result = await getReport(request.params.id, server.prisma, orgId);
      return reply.send(result);
    } catch (err) {
      if (err instanceof Error && (err as NodeJS.ErrnoException & { code?: string }).code === 'NOT_FOUND') {
        return reply.notFound(err.message);
      }
      throw err;
    }
  });

  server.get<{ Querystring: { workflow?: string }; Reply: { reports: ListReportItem[] } }>('/list', {
    onRequest: [server.authenticate],
    schema: {
      tags: ['Reports'],
      summary: 'List all compliance reports for the authenticated organization',
      querystring: {
        type: 'object',
        properties: {
          workflow: {
            type: 'string',
            enum: [...SUPPORTED_WORKFLOWS],
            description: 'Filter reports by workflow name',
          },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            reports: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id:          { type: 'string' },
                  title:       { type: 'string' },
                  status:      { type: 'string' },
                  documentIds: { type: 'array', items: { type: 'string' } },
                  documents: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        id:       { type: 'string' },
                        fileName: { type: 'string' },
                      },
                    },
                  },
                  batches: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        id:   { type: 'string' },
                        name: { type: 'string' },
                      },
                    },
                  },
                  workflows:   { type: 'array', items: { type: 'string' } },
                  summary:     { ...summarySchema, nullable: true },
                  createdAt:   { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const orgId = request.user.organizationId || null;
    const { workflow } = request.query;
    const reports = await listReports(server.prisma, orgId, workflow);
    return reply.send({ reports });
  });
};

export default reportRoutes;
