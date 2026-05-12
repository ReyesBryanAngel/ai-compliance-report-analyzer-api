import { FastifyPluginAsync } from 'fastify';
import { ensureUploadDir, saveDocument, parseDocument, createDocumentBatch } from './service';
import type { UploadResponse, UploadedDocument, BatchInfo } from './types';
import type { ParseResult } from '../parser';

interface ListQuery {
  batch_id?: string;
  document_id?: string;
}

const documentSchema = {
  type: 'object',
  properties: {
    id:             { type: 'string' },
    originalName:   { type: 'string' },
    mimeType:       { type: 'string' },
    size:           { type: 'number' },
    status:         { type: 'string' },
    batchId:        { type: 'string', nullable: true },
    uploadedById:   { type: 'string', nullable: true },
    organizationId: { type: 'string', nullable: true },
    createdAt:      { type: 'string' },
  },
};

const documentRoutes: FastifyPluginAsync = async (server) => {
  await ensureUploadDir();

  server.post<{ Reply: UploadResponse }>('/upload', {
    onRequest: [server.authenticate],
    schema: {
      tags: ['Documents'],
      summary: 'Upload one or more documents, optionally grouped into a named batch',
      description: 'Send `batch_name` (and optionally `batch_description`) as form fields **before** the file fields to group uploads into an identifiable batch.',
      consumes: ['multipart/form-data'],
      response: {
        200: {
          type: 'object',
          properties: {
            batch: {
              type: 'object',
              nullable: true,
              properties: {
                id:          { type: 'string' },
                name:        { type: 'string' },
                description: { type: 'string', nullable: true },
                createdAt:   { type: 'string' },
              },
            },
            documents: { type: 'array', items: documentSchema },
            failed: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  filename: { type: 'string' },
                  error:    { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const uploadedById = request.user.sub;
    const orgId = request.user.organizationId || undefined;
    const uploaded: UploadedDocument[] = [];
    const failed: UploadResponse['failed'] = [];
    const fields: Record<string, string> = {};

    for await (const part of request.parts()) {
      if (part.type === 'field') {
        fields[part.fieldname] = String(part.value);
        continue;
      }

      try {
        const doc = await saveDocument(part, server.prisma, uploadedById, orgId);
        uploaded.push(doc);
      } catch (err) {
        part.file.resume();
        failed.push({
          filename: part.filename,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    let batchRecord: BatchInfo | null = null;
    if (fields['batch_name'] && uploaded.length > 0) {
      batchRecord = await createDocumentBatch(
        fields['batch_name'],
        fields['batch_description'],
        server.prisma,
      );

      await server.prisma.document.updateMany({
        where: { id: { in: uploaded.map((d) => d.id) } },
        data: { batchId: batchRecord.id },
      });

      for (const doc of uploaded) {
        doc.batchId = batchRecord.id;
      }
    }

    return reply.send({ batch: batchRecord, documents: uploaded, failed });
  });

  server.get<{ Querystring: ListQuery }>('/list', {
    onRequest: [server.authenticate],
    schema: {
      tags: ['Documents'],
      summary: 'List documents uploaded by users in the same organization',
      querystring: {
        type: 'object',
        properties: {
          batch_id:    { type: 'string', description: 'Filter by batch ID' },
          document_id: { type: 'string', description: 'Filter by document ID' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            documents: { type: 'array', items: documentSchema },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { batch_id, document_id } = request.query;
    const orgId = request.user.organizationId || null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: Record<string, any> = {};
    if (batch_id) where.batchId = batch_id;
    if (document_id) where.id = document_id;
    if (orgId) where.organizationId = orgId;

    const documents = await server.prisma.document.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        originalName: true,
        mimeType: true,
        size: true,
        status: true,
        batchId: true,
        uploadedById: true,
        organizationId: true,
        createdAt: true,
      },
    });

    return reply.send({
      documents: documents.map((d) => ({ ...d, createdAt: d.createdAt.toISOString() })),
    });
  });

  server.get<{ Params: { id: string } }>('/:id', {
    onRequest: [server.authenticate],
    schema: {
      tags: ['Documents'],
      summary: 'Get a document by ID',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      response: { 200: documentSchema },
    },
  }, async (request, reply) => {
    const orgId = request.user.organizationId || null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: Record<string, any> = { id: request.params.id };
    if (orgId) where.organizationId = orgId;

    const doc = await server.prisma.document.findFirst({
      where,
      select: {
        id: true,
        originalName: true,
        mimeType: true,
        size: true,
        status: true,
        batchId: true,
        uploadedById: true,
        organizationId: true,
        createdAt: true,
      },
    });

    if (!doc) return reply.notFound('Document not found');

    return reply.send({ ...doc, createdAt: doc.createdAt.toISOString() });
  });

  server.post<{ Params: { id: string }; Reply: ParseResult }>('/:id/parse', {
    onRequest: [server.authenticate],
    schema: {
      tags: ['Documents'],
      summary: 'Parse a document and extract normalized transactions',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      response: {
        200: {
          type: 'object',
          properties: {
            transactions: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  date:        { type: 'string' },
                  description: { type: 'string' },
                  amount:      { type: 'number' },
                  direction:   { type: 'string', enum: ['inflow', 'outflow'] },
                  balance:     { type: 'number' },
                  category:    { type: 'string' },
                  channel:     { type: 'string', enum: ['bank', 'ewallet', 'transfer', 'card', 'atm'] },
                  currency:    { type: 'string' },
                  reference:   { type: 'string' },
                },
                required: ['date', 'description', 'amount', 'direction'],
              },
            },
            meta: {
              type: 'object',
              properties: {
                documentId: { type: 'string' },
                source:     { type: 'string' },
                parsedAt:   { type: 'string' },
                total:      { type: 'number' },
                skipped:    { type: 'number' },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const result = await parseDocument(request.params.id, server.prisma);
      return reply.send(result);
    } catch (err) {
      if (err instanceof Error) {
        if (err.message === 'Document not found') return reply.notFound(err.message);
        if (err.message.startsWith('No parser available')) return reply.badRequest(err.message);
      }
      throw err;
    }
  });
};

export default documentRoutes;
