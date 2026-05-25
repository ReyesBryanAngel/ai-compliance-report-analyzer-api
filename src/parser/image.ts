import { readFileSync } from 'fs';
import { createWorker } from 'tesseract.js';
import type { Readable } from 'stream';
import type { ParserStrategy, NormalizedTransaction } from './types';
import { parseTextIntoTransactions, streamToBuffer } from './text-line-parser';

// tesseract.js language data is downloaded on first use (~4 MB) and cached
// locally in the OS temp directory. Subsequent calls are fast.
export class ImageParser implements ParserStrategy {
  async parse(filePath: string): Promise<{ transactions: NormalizedTransaction[]; skipped: number }> {
    return this.parseBuffer(readFileSync(filePath));
  }

  async parseStream(stream: Readable): Promise<{ transactions: NormalizedTransaction[]; skipped: number }> {
    return this.parseBuffer(await streamToBuffer(stream));
  }

  private async parseBuffer(buffer: Buffer): Promise<{ transactions: NormalizedTransaction[]; skipped: number }> {
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
