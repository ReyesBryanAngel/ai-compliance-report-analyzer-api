import { extname } from 'path';
import { randomUUID } from 'crypto';
import { Transform } from 'stream';
import type { Readable } from 'stream';
import type { MultipartFile } from '@fastify/multipart';
import type { PrismaClient } from '../generated/prisma/client';
import { ALLOWED_MIME_TYPES, type BatchInfo, type UploadedDocument } from './types';
import { getParser, type ParseResult } from '../parser';
import { S3Client, GetObjectCommand, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const s3 = new S3Client({ region: process.env.AWS_REGION });
const BUCKET = process.env.S3_BUCKET_NAME!;
const KEY_PREFIX = process.env.S3_KEY_PREFIX ?? 'documents/';
const DOWNLOAD_URL_TTL = 3600; // 1 hour
const UPLOAD_URL_TTL = 900;   // 15 minutes

const EXT_TO_MIME: Record<string, string> = {
  '.pdf':  'application/pdf',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png':  'image/png',
  '.webp': 'image/webp',
  '.csv':  'text/csv',
  '.xls':  'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

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

export async function createUploadUrl(
  filename: string,
  prisma: PrismaClient,
  uploadedById?: string,
  organizationId?: string,
  batchId?: string,
): Promise<{ uploadUrl: string; document: UploadedDocument }> {
  const ext = extname(filename).toLowerCase();
  const contentType = EXT_TO_MIME[ext];
  if (!contentType || !ALLOWED_MIME_TYPES.includes(contentType as (typeof ALLOWED_MIME_TYPES)[number])) {
    throw new Error(`Unsupported file type: ${ext || filename}`);
  }

  const storedName = `${randomUUID()}${ext}`;
  const s3Key = `${KEY_PREFIX}${storedName}`;

  const doc = await prisma.document.create({
    data: {
      originalName: filename,
      storedName,
      mimeType: contentType,
      size: 0,
      path: s3Key,
      batchId: batchId ?? null,
      uploadedById: uploadedById ?? null,
      organizationId: organizationId ?? null,
    },
  });

  const uploadUrl = await getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: BUCKET, Key: s3Key, ContentType: contentType }),
    { expiresIn: UPLOAD_URL_TTL },
  );

  return {
    uploadUrl,
    document: {
      id: doc.id,
      originalName: doc.originalName,
      mimeType: doc.mimeType,
      size: doc.size,
      status: doc.status,
      batchId: doc.batchId,
      uploadedById: doc.uploadedById,
      organizationId: doc.organizationId,
      createdAt: doc.createdAt.toISOString(),
    },
  };
}

export async function confirmUpload(
  documentId: string,
  prisma: PrismaClient,
  organizationId?: string | null,
): Promise<void> {
  const where = organizationId
    ? { id: documentId, organizationId }
    : { id: documentId };

  const doc = await prisma.document.findFirst({ where });
  if (!doc) throw new Error('Document not found');

  const head = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: doc.path }));

  await prisma.document.update({
    where: { id: documentId },
    data: { size: head.ContentLength ?? 0 },
  });
}

export async function streamDocumentFromS3(s3Key: string): Promise<{ stream: Readable; contentLength?: number }> {
  const response = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: s3Key }));
  return {
    stream: response.Body as Readable,
    contentLength: response.ContentLength,
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
      data: { status: 'COMPLETED', parsedData: transactions },
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
