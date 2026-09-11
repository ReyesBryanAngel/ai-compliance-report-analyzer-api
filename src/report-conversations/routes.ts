import type { FastifyPluginAsync } from 'fastify';
import {
  createConversation,
  sendMessage,
  getConversation,
  listConversations,
} from './service';

type ErrWithCode = Error & { code?: string };

function getCode(err: unknown): string | undefined {
  return err instanceof Error ? (err as ErrWithCode).code : undefined;
}

const messageItemSchema = {
  type: 'object',
  properties: {
    id:               { type: 'string' },
    conversationId:   { type: 'string' },
    role:             { type: 'string', enum: ['USER', 'ASSISTANT'] },
    content:          { type: 'string' },
    sequence:         { type: 'number' },
    model:            { type: 'string', nullable: true },
    provider:         { type: 'string', nullable: true },
    promptTokens:     { type: 'number', nullable: true },
    completionTokens: { type: 'number', nullable: true },
    latencyMs:        { type: 'number', nullable: true },
    createdAt:        { type: 'string' },
  },
};

const conversationSummarySchema = {
  type: 'object',
  properties: {
    id:           { type: 'string' },
    reportId:     { type: 'string' },
    userId:       { type: 'string', nullable: true },
    messageCount: { type: 'number' },
    createdAt:    { type: 'string' },
    updatedAt:    { type: 'string' },
  },
};

const conversationDetailSchema = {
  type: 'object',
  properties: {
    id:        { type: 'string' },
    reportId:  { type: 'string' },
    userId:    { type: 'string', nullable: true },
    createdAt: { type: 'string' },
    updatedAt: { type: 'string' },
    messages:  { type: 'array', items: messageItemSchema },
  },
};

export const reportConversationRoutes: FastifyPluginAsync = async (server) => {
  // POST /api/v1/reports/:id/conversations — start a new conversation on a report
  server.post<{ Params: { id: string } }>('/:id/conversations', {
    onRequest: [server.authenticate],
    schema: {
      tags: ['Report Conversations'],
      summary: 'Start a new conversation on a completed report',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      response: {
        201: {
          type: 'object',
          properties: {
            id:        { type: 'string' },
            reportId:  { type: 'string' },
            createdAt: { type: 'string' },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { sub: userId, organizationId } = request.user;
    const orgId = organizationId || null;
    try {
      const result = await createConversation(server.prisma, request.params.id, userId, orgId);
      return reply.status(201).send(result);
    } catch (err) {
      const code = getCode(err);
      if (code === 'NOT_FOUND') return reply.notFound((err as Error).message);
      if (code === 'REPORT_NOT_COMPLETED') return reply.badRequest((err as Error).message);
      throw err;
    }
  });

  // POST /api/v1/reports/:id/conversations/:conversationId/messages — send a message
  server.post<{
    Params: { id: string; conversationId: string };
    Body: { message: string };
  }>('/:id/conversations/:conversationId/messages', {
    onRequest: [server.authenticate],
    schema: {
      tags: ['Report Conversations'],
      summary: 'Send a message and receive an AI response based on the report',
      params: {
        type: 'object',
        properties: {
          id:             { type: 'string' },
          conversationId: { type: 'string' },
        },
        required: ['id', 'conversationId'],
      },
      body: {
        type: 'object',
        required: ['message'],
        properties: {
          message: { type: 'string', minLength: 1, maxLength: 2000 },
        },
      },
      response: {
        200: messageItemSchema,
      },
    },
  }, async (request, reply) => {
    const { sub: userId, organizationId } = request.user;
    const orgId = organizationId || null;
    const { id: reportId, conversationId } = request.params;
    try {
      const result = await sendMessage(
        server.prisma,
        reportId,
        conversationId,
        request.body.message,
        userId,
        orgId,
      );
      return reply.send(result);
    } catch (err) {
      const code = getCode(err);
      if (code === 'NOT_FOUND') return reply.notFound((err as Error).message);
      if (code === 'VALIDATION') return reply.badRequest((err as Error).message);
      if (code === 'LLM_ERROR' || code === 'LLM_UNAVAILABLE') {
        return reply.status(502).send({ message: 'Failed to generate response' });
      }
      throw err;
    }
  });

  // GET /api/v1/reports/:id/conversations/:conversationId — full message history
  server.get<{ Params: { id: string; conversationId: string } }>(
    '/:id/conversations/:conversationId',
    {
      onRequest: [server.authenticate],
      schema: {
        tags: ['Report Conversations'],
        summary: 'Get a conversation with its full message history',
        params: {
          type: 'object',
          properties: {
            id:             { type: 'string' },
            conversationId: { type: 'string' },
          },
          required: ['id', 'conversationId'],
        },
        response: { 200: conversationDetailSchema },
      },
    },
    async (request, reply) => {
      const orgId = request.user.organizationId || null;
      const { id: reportId, conversationId } = request.params;
      try {
        const result = await getConversation(server.prisma, reportId, conversationId, orgId);
        return reply.send(result);
      } catch (err) {
        if (getCode(err) === 'NOT_FOUND') return reply.notFound((err as Error).message);
        throw err;
      }
    },
  );

  // GET /api/v1/reports/:id/conversations — list all conversations for a report
  server.get<{ Params: { id: string } }>('/:id/conversations', {
    onRequest: [server.authenticate],
    schema: {
      tags: ['Report Conversations'],
      summary: 'List all conversations for a report',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      response: {
        200: {
          type: 'object',
          properties: {
            conversations: { type: 'array', items: conversationSummarySchema },
          },
        },
      },
    },
  }, async (request, reply) => {
    const orgId = request.user.organizationId || null;
    try {
      const conversations = await listConversations(server.prisma, request.params.id, orgId);
      return reply.send({ conversations });
    } catch (err) {
      if (getCode(err) === 'NOT_FOUND') return reply.notFound((err as Error).message);
      throw err;
    }
  });
};
