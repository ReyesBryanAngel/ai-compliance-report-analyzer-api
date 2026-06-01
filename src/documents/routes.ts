import { FastifyPluginAsync } from 'fastify';
import { saveDocument, parseDocument, createDocumentBatch, getDownloadUrl, createUploadUrl, confirmUpload, streamDocumentFromS3 } from './service';
import type { UploadResponse, UploadedDocument, BatchInfo } from './types';
import type { ParseResult } from '../parser';

interface ListQuery {
  batch_id?: string;
  document_id?: string;
}

interface UploadUrlBody {
  files: Array<{ filename: string }>;
  batchName?: string;
  batchDescription?: string;
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
    uploadedById:   { type: 'string', nullable: true },
    organizationId: { type: 'string', nullable: true },
    createdAt:      { type: 'string' },
    downloadUrl:    { type: 'string' },
    parsedData:     { nullable: true },
  },
};

const documentRoutes: FastifyPluginAsync = async (server) => {
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
        parseDocument(doc.id, server.prisma).catch((err: unknown) => {
          server.log.error({ docId: doc.id, err }, 'Background parse failed');
        });
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
        path: true,
        batchId: true,
        batch: {
          select: {
            id: true,
            name: true,
            description: true,
            createdAt: true,
          },
        },
        uploadedById: true,
        organizationId: true,
        createdAt: true,
      },
    });

    const documentsWithUrls = await Promise.all(
      documents.map(async (d) => ({
        ...d,
        createdAt: d.createdAt.toISOString(),
        batch: d.batch ? { ...d.batch, createdAt: d.batch.createdAt.toISOString() } : null,
        downloadUrl: await getDownloadUrl(d.path),
      })),
    );

    return reply.send({ documents: documentsWithUrls });
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
        path: true,
        batchId: true,
        uploadedById: true,
        organizationId: true,
        createdAt: true,
        parsedData: true,
      },
    });

    if (!doc) return reply.notFound('Document not found');

    const downloadUrl = await getDownloadUrl(doc.path);
    return reply.send({ ...doc, createdAt: doc.createdAt.toISOString(), downloadUrl });
  });

  server.get<{ Params: { id: string } }>('/:id/file', {
    onRequest: [server.authenticate],
    schema: {
      tags: ['Documents'],
      summary: 'Stream the raw file content through the API (no expiry)',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
    },
  }, async (request, reply) => {
    const orgId = request.user.organizationId || null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: Record<string, any> = { id: request.params.id };
    if (orgId) where.organizationId = orgId;

    const doc = await server.prisma.document.findFirst({
      where,
      select: { path: true, mimeType: true, originalName: true },
    });

    if (!doc) return reply.notFound('Document not found');

    const { stream, contentLength } = await streamDocumentFromS3(doc.path);

    reply.header('Content-Type', doc.mimeType);
    reply.header('Content-Disposition', `inline; filename="${encodeURIComponent(doc.originalName)}"`);
    if (contentLength !== undefined) reply.header('Content-Length', String(contentLength));

    return reply.send(stream);
  });

  server.post<{ Body: UploadUrlBody }>('/upload-url', {
    onRequest: [server.authenticate],
    schema: {
      tags: ['Documents'],
      summary: 'Request pre-signed S3 URLs for direct browser upload',
      body: {
        type: 'object',
        required: ['files'],
        properties: {
          files: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              required: ['filename'],
              properties: { filename: { type: 'string' } },
            },
          },
          batchName:        { type: 'string' },
          batchDescription: { type: 'string' },
        },
      },
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
            documents: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  uploadUrl: { type: 'string' },
                  document:  documentSchema,
                },
              },
            },
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
    const { files, batchName, batchDescription } = request.body;
    const uploadedById = request.user.sub;
    const orgId = request.user.organizationId || undefined;

    let batchRecord: BatchInfo | null = null;
    let batchId: string | undefined;
    if (batchName) {
      batchRecord = await createDocumentBatch(batchName, batchDescription, server.prisma);
      batchId = batchRecord.id;
    }

    const results = await Promise.allSettled(
      files.map(({ filename }) => createUploadUrl(filename, server.prisma, uploadedById, orgId, batchId)),
    );

    const documents: Array<{ uploadUrl: string; document: UploadedDocument }> = [];
    const failed: Array<{ filename: string; error: string }> = [];

    results.forEach((result, i) => {
      if (result.status === 'fulfilled') {
        documents.push(result.value);
      } else {
        failed.push({
          filename: files[i].filename,
          error: result.reason instanceof Error ? result.reason.message : 'Unknown error',
        });
      }
    });

    return reply.send({ batch: batchRecord, documents, failed });
  });

  server.post<{ Params: { id: string } }>('/:id/confirm', {
    onRequest: [server.authenticate],
    schema: {
      tags: ['Documents'],
      summary: 'Confirm a direct S3 upload and trigger background parsing',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      response: {
        200: {
          type: 'object',
          properties: { message: { type: 'string' } },
        },
      },
    },
  }, async (request, reply) => {
    const orgId = request.user.organizationId || null;
    let batchId: string | null = null;
    try {
      ({ batchId } = await confirmUpload(request.params.id, server.prisma, orgId));
    } catch (err) {
      if (err instanceof Error) {
        if (err.message === 'Document not found') return reply.notFound(err.message);
        if ((err as NodeJS.ErrnoException).name === 'NotFound') {
          return reply.badRequest('File not found in S3 — upload may not have completed');
        }
      }
      throw err;
    }

    parseDocument(request.params.id, server.prisma).catch((err: unknown) => {
      server.log.error({ docId: request.params.id, err }, 'Background parse failed');
    });

    let count = 1;
    if (batchId) {
      count = await server.prisma.document.count({
        where: { batchId, size: { gt: 0 } },
      });
    }
    const noun = count === 1 ? 'document' : 'documents';
    return reply.send({ message: `${count} ${noun} uploaded successfully.` });
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
