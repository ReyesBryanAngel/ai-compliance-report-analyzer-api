import { CsvParser } from './csv';
import { PdfParser } from './pdf';
import { ImageParser } from './image';
import type { ParserStrategy } from './types';

const PARSEABLE_MIME_TYPES = [
  'text/csv',
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export type ParseableMimeType = (typeof PARSEABLE_MIME_TYPES)[number];

export function getParser(mimeType: string): ParserStrategy | null {
  switch (mimeType) {
    case 'text/csv':
      return new CsvParser();
    case 'application/pdf':
      return new PdfParser();
    case 'image/jpeg':
    case 'image/png':
    case 'image/webp':
      return new ImageParser();
    default:
      return null;
  }
}

export function isParseableMimeType(mimeType: string): mimeType is ParseableMimeType {
  return (PARSEABLE_MIME_TYPES as readonly string[]).includes(mimeType);
}

export type { NormalizedTransaction, ParseResult, ParserStrategy } from './types';
