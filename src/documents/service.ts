import { extname } from 'path';
import { randomUUID } from 'crypto';
import { Transform } from 'stream';
import type { Readable } from 'stream';
import type { MultipartFile } from '@fastify/multipart';
import type { PrismaClient } from '../generated/prisma/client';
import { ALLOWED_MIME_TYPES, type BatchInfo, type UploadedDocument } from './types';
import { getParser, type ParseResult } from '../parser';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const s3 = new S3Client({ region: process.env.AWS_REGION });
const BUCKET = process.env.S3_BUCKET_NAME!;
const KEY_PREFIX = process.env.S3_KEY_PREFIX ?? 'documents/';
const DOWNLOAD_URL_TTL = 3600; // 1 hour

export async function getDownloadUrl(s3Key: string): Promise<string> {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: s3Key }), { expiresIn: DOWNLOAD_URL_TTL });
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
  uploadedById?: string,
  organizationId?: string,
  batchId?: string,
): Promise<UploadedDocument> {
  if (!ALLOWED_MIME_TYPES.includes(part.mimetype as (typeof ALLOWED_MIME_TYPES)[number])) {
    throw new Error(`Unsupported file type: ${part.mimetype}`);
  }

  const ext = extname(part.filename);
  const storedName = `${randomUUID()}${ext}`;
  const s3Key = `${KEY_PREFIX}${storedName}`;

  let size = 0;
  const sizeCounter = new Transform({
    transform(chunk, _enc, cb) {
      size += (chunk as Buffer).length;
      cb(null, chunk);
    },
  });

  await new Upload({
    client: s3,
    params: {
      Bucket: BUCKET,
      Key: s3Key,
      Body: part.file.pipe(sizeCounter),
      ContentType: part.mimetype,
    },
  }).done();

  const doc = await prisma.document.create({
    data: {
      originalName: part.filename,
      storedName,
      mimeType: part.mimetype,
      size,
      path: s3Key,
      status: 'COMPLETED',
      batchId: batchId ?? null,
      uploadedById: uploadedById ?? null,
      organizationId: organizationId ?? null,
    },
  });

  return {
    id: doc.id,
    originalName: doc.originalName,
    mimeType: doc.mimeType,
    size: doc.size,
    status: doc.status,
    batchId: doc.batchId,
    uploadedById: doc.uploadedById,
    organizationId: doc.organizationId,
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
    const { Body } = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: doc.path }));
    const { transactions, skipped } = await parser.parseStream(Body as Readable);
    await prisma.document.update({
      where: { id: documentId },
      data: { status: 'PROCESSED', parsedData: transactions },
    });

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
