/**
 * Quick smoke-test for LlamaParse integration.
 * Usage:  npx tsx --env-file .env src/parser/test-llama.ts <path-to-pdf-or-image>
 *
 * Shows:
 *   1. Raw markdown returned by LlamaParse
 *   2. NormalizedTransaction[] after column-aware table parsing
 */

import { readFileSync } from 'fs';
import { extname } from 'path';
import { llamaParseBuffer, parseLlamaMarkdownToTransactions } from './llama-parse';

const MIME_MAP: Record<string, string> = {
  '.pdf':  'application/pdf',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png':  'image/png',
  '.webp': 'image/webp',
};

void (async () => {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: npx tsx --env-file .env src/parser/test-llama.ts <file>');
    process.exit(1);
  }

  const mimeType = MIME_MAP[extname(filePath).toLowerCase()];
  if (!mimeType) {
    console.error(`Unsupported extension: ${extname(filePath)}`);
    process.exit(1);
  }

  const buffer = readFileSync(filePath);
  const filename = filePath.split(/[\\/]/).pop()!;

  console.log('\n── Step 1: Raw LlamaParse markdown ─────────────────────────────────');
  const markdown = await llamaParseBuffer(buffer, mimeType, filename);
  if (!markdown) {
    console.log('LlamaParse returned null (check LLAMA_PARSE_API_KEY or file type)');
    process.exit(0);
  }
  console.log(markdown);

  console.log('\n── Step 2: NormalizedTransaction[] ──────────────────────────────────');
  const { transactions, skipped } = parseLlamaMarkdownToTransactions(markdown);
  console.log(JSON.stringify(transactions, null, 2));
  console.log(`\nTotal parsed: ${transactions.length}  |  Skipped: ${skipped}`);
})();
