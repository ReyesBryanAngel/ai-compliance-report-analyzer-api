import { FastifyPluginAsync } from 'fastify';
import { ensureUploadDir, saveDocument } from './service';
import type { UploadResponse, UploadedDocument } from './types';

const documentRoutes: FastifyPluginAsync = async (server) => {
  await ensureUploadDir();

  server.post<{ Reply: UploadResponse }>('/upload', {
    schema: {
      tags: ['Documents'],
      summary: 'Upload one or more documents',
      consumes: ['multipart/form-data'],
      response: {
        200: {
          type: 'object',
          properties: {
            documents: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  originalName: { type: 'string' },
                  mimeType: { type: 'string' },
                  size: { type: 'number' },
                  status: { type: 'string' },
                  createdAt: { type: 'string' },
                },
              },
            },
            failed: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  filename: { type: 'string' },
                  error: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const uploaded: UploadedDocument[] = [];
    const failed: UploadResponse['failed'] = [];

    for await (const part of request.files()) {
      try {
        const doc = await saveDocument(part, server.prisma);
        uploaded.push(doc);
      } catch (err) {
        // Drain the stream to prevent the request from hanging
        part.file.resume();
        failed.push({
          filename: part.filename,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    return reply.send({ documents: uploaded, failed });
  });

  server.get('/list', {
    schema: {
      tags: ['Documents'],
      summary: 'List all uploaded documents',
      response: {
        200: {
          type: 'object',
          properties: {
            documents: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  originalName: { type: 'string' },
                  mimeType: { type: 'string' },
                  size: { type: 'number' },
                  status: { type: 'string' },
                  createdAt: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
  }, async (_request, reply) => {
    const documents = await server.prisma.document.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        originalName: true,
        mimeType: true,
        size: true,
        status: true,
        createdAt: true,
      },
    });

    return reply.send({
      documents: documents.map((d) => ({ ...d, createdAt: d.createdAt.toISOString() })),
    });
  });

  server.get<{ Params: { id: string } }>('/:id', {
    schema: {
      tags: ['Documents'],
      summary: 'Get a document by ID',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      response: {
        200: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            originalName: { type: 'string' },
            mimeType: { type: 'string' },
            size: { type: 'number' },
            status: { type: 'string' },
            createdAt: { type: 'string' },
          },
        },
      },
    },
  }, async (request, reply) => {
    const doc = await server.prisma.document.findUnique({
      where: { id: request.params.id },
      select: {
        id: true,
        originalName: true,
        mimeType: true,
        size: true,
        status: true,
        createdAt: true,
      },
    });

    if (!doc) {
      return reply.notFound('Document not found');
    }

    return reply.send({ ...doc, createdAt: doc.createdAt.toISOString() });
  });
};

export default documentRoutes;
