import { pipeline } from 'stream/promises';
import { createWriteStream } from 'fs';
import { mkdir } from 'fs/promises';
import { join, extname } from 'path';
import { randomUUID } from 'crypto';
import { Transform } from 'stream';
import type { MultipartFile } from '@fastify/multipart';
import type { PrismaClient } from '../generated/prisma/client';
import { ALLOWED_MIME_TYPES, type BatchInfo, type UploadedDocument } from './types';
import { getParser, type ParseResult } from '../parser';

// Swap this path for an S3 bucket key prefix when migrating to cloud storage
const UPLOAD_DIR = join(process.cwd(), 'uploads', 'documents');

export async function ensureUploadDir(): Promise<void> {
  await mkdir(UPLOAD_DIR, { recursive: true });
}

export async function createDocumentBatch(
  name: string,
  description: string | undefined,
  prisma: PrismaClient,
): Promise<BatchInfo> {
  const batch = await prisma.documentBatch.create({
    data: { name, description },
  });
  return {
    id: batch.id,
    name: batch.name,
    description: batch.description,
    createdAt: batch.createdAt.toISOString(),
  };
}

export async function saveDocument(
  part: MultipartFile,
  prisma: PrismaClient,
  batchId?: string,
): Promise<UploadedDocument> {
  if (!ALLOWED_MIME_TYPES.includes(part.mimetype as (typeof ALLOWED_MIME_TYPES)[number])) {
    throw new Error(`Unsupported file type: ${part.mimetype}`);
  }

  const ext = extname(part.filename);
  const storedName = `${randomUUID()}${ext}`;
  const filePath = join(UPLOAD_DIR, storedName);

  let size = 0;
  const sizeCounter = new Transform({
    transform(chunk, _enc, cb) {
      size += (chunk as Buffer).length;
      cb(null, chunk);
    },
  });

  await pipeline(part.file, sizeCounter, createWriteStream(filePath));

  const doc = await prisma.document.create({
    data: {
      originalName: part.filename,
      storedName,
      mimeType: part.mimetype,
      size,
      path: filePath,
      status: 'COMPLETED',
      batchId: batchId ?? null,
    },
  });

  return {
    id: doc.id,
    originalName: doc.originalName,
    mimeType: doc.mimeType,
    size: doc.size,
    status: doc.status,
    batchId: doc.batchId,
    createdAt: doc.createdAt.toISOString(),
  };
}

export async function parseDocument(documentId: string, prisma: PrismaClient): Promise<ParseResult> {
  const doc = await prisma.document.findUnique({ where: { id: documentId } });
  if (!doc) throw new Error('Document not found');

  const parser = getParser(doc.mimeType);
  if (!parser) throw new Error(`No parser available for file type: ${doc.mimeType}`);

  await prisma.document.update({ where: { id: documentId }, data: { status: 'PROCESSING' } });

  try {
    const { transactions, skipped } = await parser.parse(doc.path);
    await prisma.document.update({ where: { id: documentId }, data: { status: 'PROCESSED' } });

    return {
      transactions,
      meta: {
        documentId: doc.id,
        source: doc.originalName,
        parsedAt: new Date().toISOString(),
        total: transactions.length,
        skipped,
      },
    };
  } catch (err) {
    await prisma.document.update({ where: { id: documentId }, data: { status: 'FAILED' } });
    throw err;
  }
}
