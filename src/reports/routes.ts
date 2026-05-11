import { FastifyPluginAsync } from 'fastify';
import { generateReport, getReport, listReports } from './service';
import { SUPPORTED_WORKFLOWS } from '../risk-engine';
import type { GenerateReportBody, GenerateReportResponse, ListReportItem } from './types';

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
  server.post<{ Body: GenerateReportBody; Reply: GenerateReportResponse }>('/generate', {
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
      response: { 200: reportResponseSchema },
    },
  }, async (request, reply) => {
    try {
      const result = await generateReport(request.body, server.prisma);
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
      const result = await getReport(request.params.id, server.prisma);
      return reply.send(result);
    } catch (err) {
      if (err instanceof Error && (err as NodeJS.ErrnoException & { code?: string }).code === 'NOT_FOUND') {
        return reply.notFound(err.message);
      }
      throw err;
    }
  });

  server.get<{ Reply: { reports: ListReportItem[] } }>('/list', {
    schema: {
      tags: ['Reports'],
      summary: 'List all compliance reports',
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
  }, async (_request, reply) => {
    const reports = await listReports(server.prisma);
    return reply.send({ reports });
  });
};

export default reportRoutes;
