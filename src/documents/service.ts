import { pipeline } from 'stream/promises';
import { createWriteStream } from 'fs';
import { mkdir } from 'fs/promises';
import { join, extname } from 'path';
import { randomUUID } from 'crypto';
import { Transform } from 'stream';
import type { MultipartFile } from '@fastify/multipart';
import type { PrismaClient } from '../generated/prisma/client';
import { ALLOWED_MIME_TYPES, type UploadedDocument } from './types';

// Swap this path for an S3 bucket key prefix when migrating to cloud storage
const UPLOAD_DIR = join(process.cwd(), 'uploads', 'documents');

export async function ensureUploadDir(): Promise<void> {
  await mkdir(UPLOAD_DIR, { recursive: true });
}

export async function saveDocument(
  part: MultipartFile,
  prisma: PrismaClient
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
    },
  });

  return {
    id: doc.id,
    originalName: doc.originalName,
    mimeType: doc.mimeType,
    size: doc.size,
    status: doc.status,
    createdAt: doc.createdAt.toISOString(),
  };
}
