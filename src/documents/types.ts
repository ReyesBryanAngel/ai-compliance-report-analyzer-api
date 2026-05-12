export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const;

export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

export interface BatchInfo {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
}

export interface UploadedDocument {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  status: string;
  batchId: string | null;
  uploadedById: string | null;
  organizationId: string | null;
  createdAt: string;
}

export interface UploadResponse {
  batch: BatchInfo | null;
  documents: UploadedDocument[];
  failed: Array<{ filename: string; error: string }>;
}
