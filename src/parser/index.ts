import { CsvParser } from './csv';
import type { ParserStrategy } from './types';

const PARSEABLE_MIME_TYPES = ['text/csv'] as const;
export type ParseableMimeType = (typeof PARSEABLE_MIME_TYPES)[number];

export function getParser(mimeType: string): ParserStrategy | null {
  switch (mimeType) {
    case 'text/csv':
      return new CsvParser();
    // Future: case 'application/pdf': return new PdfParser();
    // Future: case 'image/jpeg': case 'image/png': return new OcrParser();
    default:
      return null;
  }
}

export function isParseableMimeType(mimeType: string): mimeType is ParseableMimeType {
  return (PARSEABLE_MIME_TYPES as readonly string[]).includes(mimeType);
}

export type { NormalizedTransaction, ParseResult, ParserStrategy } from './types';
