import { createReadStream } from 'fs';
import { parse } from 'csv-parse';
import type { Readable } from 'stream';
import type { ParserStrategy, NormalizedTransaction } from './types';
import {
  detectColumns,
  parseAmount,
  parseDate,
  detectChannel,
  detectCategory,
  extractBeneficiaryId,
} from './normalize';

export class CsvParser implements ParserStrategy {
  async parse(filePath: string): Promise<{ transactions: NormalizedTransaction[]; skipped: number }> {
    return this.parseStream(createReadStream(filePath));
  }

  async parseStream(stream: Readable): Promise<{ transactions: NormalizedTransaction[]; skipped: number }> {
    const rows: Record<string, string>[] = await this.readCsvStream(stream);
    if (rows.length === 0) return { transactions: [], skipped: 0 };

    const headers = Object.keys(rows[0]);
    const cols = detectColumns(headers);

    if (!cols.date || !cols.description) {
      throw new Error('CSV is missing required columns: date and description');
    }

    const transactions: NormalizedTransaction[] = [];
    let skipped = 0;

    for (const row of rows) {
      const rawDate = row[cols.date];
      const rawDesc = row[cols.description];

      const date = parseDate(rawDate);
      const description = rawDesc?.trim();

      if (!date || !description) {
        skipped++;
        continue;
      }

      const { amount, direction } = this.resolveAmount(row, cols);
      if (amount === null) {
        skipped++;
        continue;
      }

      const tx: NormalizedTransaction = {
        date,
        description,
        amount: amount.toFixed(2),
        direction,
      };

      if (cols.balance) {
        const bal = parseAmount(row[cols.balance]);
        if (bal !== null) tx.balance = Math.abs(bal).toFixed(2);
      }

      if (cols.currency) {
        const cur = row[cols.currency]?.trim();
        if (cur) tx.currency = cur.toUpperCase();
      }

      if (cols.reference) {
        const ref = row[cols.reference]?.trim();
        if (ref) tx.reference = ref;
      }

      tx.channel = detectChannel(description);
      const category = detectCategory(description, direction);
      if (category) tx.category = category;
      const beneficiaryId = extractBeneficiaryId(description);
      if (beneficiaryId) tx.beneficiaryId = beneficiaryId;

      transactions.push(tx);
    }

    return { transactions, skipped };
  }

  private resolveAmount(
    row: Record<string, string>,
    cols: ReturnType<typeof detectColumns>,
  ): { amount: number; direction: 'inflow' | 'outflow' } | { amount: null; direction: never } {
    // Strategy 1: separate debit / credit columns
    if (cols.debit || cols.credit) {
      const debit = cols.debit ? parseAmount(row[cols.debit]) : null;
      const credit = cols.credit ? parseAmount(row[cols.credit]) : null;

      if (debit !== null && Math.abs(debit) > 0) {
        return { amount: Math.abs(debit), direction: 'outflow' };
      }
      if (credit !== null && Math.abs(credit) > 0) {
        return { amount: Math.abs(credit), direction: 'inflow' };
      }
      return { amount: null } as never;
    }

    // Strategy 2: single amount column — explicit direction column takes priority over sign
    if (cols.amount) {
      const raw = parseAmount(row[cols.amount]);
      if (raw === null) return { amount: null } as never;

      if (cols.direction) {
        const dirRaw = row[cols.direction]?.trim().toLowerCase();
        if (dirRaw === 'outflow' || dirRaw === 'debit' || dirRaw === 'dr') {
          return { amount: Math.abs(raw), direction: 'outflow' };
        }
        if (dirRaw === 'inflow' || dirRaw === 'credit' || dirRaw === 'cr') {
          return { amount: Math.abs(raw), direction: 'inflow' };
        }
      }

      return {
        amount: Math.abs(raw),
        direction: raw < 0 ? 'outflow' : 'inflow',
      };
    }

    return { amount: null } as never;
  }

  private readCsvStream(stream: Readable): Promise<Record<string, string>[]> {
    return new Promise((resolve, reject) => {
      const records: Record<string, string>[] = [];
      const parser = parse({ columns: true, skip_empty_lines: true, trim: true, relax_column_count: true });

      parser.on('readable', () => {
        let record: Record<string, string>;
        while ((record = parser.read()) !== null) {
          records.push(record);
        }
      });

      parser.on('error', reject);
      parser.on('end', () => resolve(records));

      stream.pipe(parser);
    });
  }
}
