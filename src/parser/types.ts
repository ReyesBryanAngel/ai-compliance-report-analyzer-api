export type NormalizedTransaction = {
  date: string;           // ISO 8601 YYYY-MM-DD
  description: string;
  amount: number;         // absolute value, always positive
  direction: 'inflow' | 'outflow';
  balance?: number;
  category?: string;
  channel?: 'bank' | 'ewallet' | 'transfer' | 'card' | 'atm';
  currency?: string;      // ISO 4217 e.g. "PHP", "USD"
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

export interface ParserStrategy {
  parse(filePath: string): Promise<{ transactions: NormalizedTransaction[]; skipped: number }>;
}
