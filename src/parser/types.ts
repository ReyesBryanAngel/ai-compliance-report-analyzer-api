export type NormalizedTransaction = {
  date: string;           // ISO 8601 YYYY-MM-DD
  description: string;
  amount: string;         // absolute value, always positive, formatted with 2 decimal places e.g. "100.00"
  direction: 'inflow' | 'outflow';
  balance?: string;       // formatted with 2 decimal places e.g. "600.00"
  category?: string;
  channel?: 'bank' | 'ewallet' | 'transfer' | 'card' | 'atm';
  currency?: string;      // ISO 4217 e.g. "PHP", "USD"
  // country?: string;    // temporarily disabled — ISO 3166-1 alpha-2 e.g. "PH", "US", "SG" — counterparty jurisdiction
  reference?: string;     // transaction reference / check number
  beneficiaryId?: string; // canonical recipient key: "phone:09171234567", "acct:1234567890", or "name:juan-dela-cruz"
};

export type ParseResult = {
  transactions: NormalizedTransaction[];
  meta: {
    documentId: string;
    source: string;       // original filename
    parsedAt: string;     // ISO 8601
    total: number;        // successfully parsed rows
    skipped: number;      // rows that could not be parsed
  };
};

import type { Readable } from 'stream';

export interface ParserStrategy {
  parse(filePath: string): Promise<{ transactions: NormalizedTransaction[]; skipped: number }>;
  parseStream(stream: Readable): Promise<{ transactions: NormalizedTransaction[]; skipped: number }>;
}
