import { readFileSync } from 'fs';
import type { Readable } from 'stream';
import type { ParserStrategy, NormalizedTransaction } from './types';
import { parseTextIntoTransactions, streamToBuffer } from './text-line-parser';
import { llamaParseBuffer, parseLlamaMarkdownToTransactions, stripMarkdownTables } from './llama-parse';

export class PdfParser implements ParserStrategy {
  async parse(filePath: string): Promise<{ transactions: NormalizedTransaction[]; skipped: number }> {
    return this.parseBuffer(readFileSync(filePath), filePath.split(/[\\/]/).pop() ?? 'document.pdf');
  }

  async parseStream(stream: Readable): Promise<{ transactions: NormalizedTransaction[]; skipped: number }> {
    return this.parseBuffer(await streamToBuffer(stream));
  }

  private async parseBuffer(
    buffer: Buffer,
    filename = 'document.pdf',
  ): Promise<{ transactions: NormalizedTransaction[]; skipped: number }> {
    const markdown = await llamaParseBuffer(buffer, 'application/pdf', filename);
    if (!markdown) {
      throw new Error(
        'LlamaParse could not parse this PDF (check LLAMA_PARSE_API_KEY and the LlamaParse service status)',
      );
    }

    const structured = parseLlamaMarkdownToTransactions(markdown);
    if (structured.transactions.length > 0) return structured;

    // LlamaParse returned markdown but no recognizable transaction table (e.g.
    // an unusual layout) — fall back to a generic line-based scan of the same
    // markdown text rather than giving up entirely.
    return parseTextIntoTransactions(stripMarkdownTables(markdown));
  }
}
