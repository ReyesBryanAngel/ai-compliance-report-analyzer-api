import { readFileSync } from 'fs';
import { createWorker } from 'tesseract.js';
import type { Readable } from 'stream';
import type { ParserStrategy, NormalizedTransaction } from './types';
import { parseTextIntoTransactions, streamToBuffer } from './text-line-parser';
import { llamaParseBuffer, stripMarkdownTables } from './llama-parse';

// tesseract.js language data is downloaded on first use (~4 MB) and cached
// locally in the OS temp directory. Subsequent calls are fast.
export class ImageParser implements ParserStrategy {
  private readonly mimeType: string;

  constructor(mimeType = 'image/jpeg') {
    this.mimeType = mimeType;
  }

  async parse(filePath: string): Promise<{ transactions: NormalizedTransaction[]; skipped: number }> {
    return this.parseBuffer(readFileSync(filePath), filePath.split(/[\\/]/).pop() ?? 'document.jpg');
  }

  async parseStream(stream: Readable): Promise<{ transactions: NormalizedTransaction[]; skipped: number }> {
    const ext = this.mimeType.split('/')[1] ?? 'jpg';
    return this.parseBuffer(await streamToBuffer(stream), `document.${ext}`);
  }

  private async parseBuffer(
    buffer: Buffer,
    filename: string,
  ): Promise<{ transactions: NormalizedTransaction[]; skipped: number }> {
    const markdown = await llamaParseBuffer(buffer, this.mimeType, filename);
    if (markdown) {
      const result = parseTextIntoTransactions(stripMarkdownTables(markdown));
      if (result.transactions.length > 0) return result;
    }

    // Fallback: local Tesseract OCR
    const worker = await createWorker('eng');
    try {
      const {
        data: { text },
      } = await worker.recognize(buffer);
      return parseTextIntoTransactions(text);
    } finally {
      await worker.terminate();
    }
  }
}
