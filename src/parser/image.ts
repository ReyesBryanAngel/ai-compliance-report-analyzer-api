import { readFileSync } from 'fs';
import type { Readable } from 'stream';
import type { ParserStrategy, NormalizedTransaction } from './types';
import { parseTextIntoTransactions, streamToBuffer } from './text-line-parser';
import { llamaParseBuffer, stripMarkdownTables } from './llama-parse';

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
    if (!markdown) {
      throw new Error(
        'LlamaParse could not parse this image (check LLAMA_PARSE_API_KEY and the LlamaParse service status)',
      );
    }

    return parseTextIntoTransactions(stripMarkdownTables(markdown));
  }
}
