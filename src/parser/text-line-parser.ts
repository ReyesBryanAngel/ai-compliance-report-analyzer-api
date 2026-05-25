import type { Readable } from 'stream';
import type { NormalizedTransaction } from './types';
import {
  parseDate,
  parseAmount,
  detectChannel,
  detectCategory,
  extractBeneficiaryId,
  detectCountry,
} from './normalize';

// Date anchored at start of a line — covers ISO, DD/MM/YYYY, MM/DD/YYYY, DD-Mon-YYYY, Mon DD YYYY
const LINE_DATE_RE =
  /^(\d{4}[-\/]\d{2}[-\/]\d{2}|\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4}|\d{1,2}[-\s](?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[-,.\s]+\d{4}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4})/i;

// Monetary amounts: integers starting with a non-zero digit (e.g. 30000, 1,234) or
// decimal amounts including zero-lead (e.g. 1,234.50, 0.75).
// Requiring the integer part to start with [1-9] prevents false matches on
// zero-padded reference codes like REF000, FAIL001, etc. that appear on
// supplementary PDF pages and get folded into the last transaction block.
const AMOUNT_PATTERN = /(?<!\d)([1-9][\d,]*(?:\.\d{1,2})?|0\.\d{1,2})(?!\d)/g;

// Strips in-block noise folded from supplementary PDF pages into the last
// transaction block: page-separator markers, pagination ("1 of 2", "Page 1 of 2"),
// and zero-padded OCR/reference codes (FAIL001, REF0042) that carry no transaction data.
const BLOCK_NOISE_RE =
  /\s*--\s+of\s+--\s*|\b(?:page\s+)?\d+\s+of\s+\d+\b|\b(?:FAIL|REF|TXN)\d{3,}\b/gi;

// Skip known page-furniture lines (headers, footers, section totals).
// "reference" is included to discard supplementary column-header pages that
// PDF parsers append after the main data page.
const PAGE_FURNITURE_RE =
  /^(page\b|date\s+description|reference\b|beginning\s+balance|ending\s+balance|opening\s+balance|closing\s+balance|total\s+(debit|credit)|account\s+(no|number|name|holder)|statement\s+(date|period|of)|deposits?\s+and\s+credits?|withdrawals?\s+and\s+debits?|transaction\s+history|balance\s+brought\s+forward|brought\s+forward)/i;

export function parseTextIntoTransactions(text: string): {
  transactions: NormalizedTransaction[];
  skipped: number;
} {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

  // Group lines into blocks. A new block starts on every line that begins
  // with a recognizable date; continuation lines (no date) are folded in.
  const blocks: string[] = [];
  let current = '';

  for (const line of lines) {
    if (PAGE_FURNITURE_RE.test(line)) continue;

    if (LINE_DATE_RE.test(line)) {
      if (current) blocks.push(current);
      current = line;
    } else if (current) {
      current += ' ' + line;
    }
  }
  if (current) blocks.push(current);

  const transactions: NormalizedTransaction[] = [];
  let skipped = 0;

  for (const block of blocks) {
    const tx = parseBlock(block);
    if (tx) {
      transactions.push(tx);
    } else {
      skipped++;
    }
  }

  return { transactions, skipped };
}

function parseBlock(block: string): NormalizedTransaction | null {
  const dateMatch = block.match(LINE_DATE_RE);
  if (!dateMatch) return null;

  const date = parseDate(dateMatch[1]);
  if (!date) return null;

  const afterDate = block.slice(dateMatch[0].length).replace(BLOCK_NOISE_RE, ' ').trim();

  // Extract all monetary amounts in order of appearance
  const amounts: number[] = [];
  const amountRe = new RegExp(AMOUNT_PATTERN.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = amountRe.exec(afterDate)) !== null) {
    const v = parseAmount(m[1]);
    if (v !== null) amounts.push(Math.abs(v));
  }

  if (amounts.length === 0) return null;

  // Strip amount strings to get a clean description
  const description = afterDate
    .replace(new RegExp(AMOUNT_PATTERN.source, 'g'), '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!description || description.length < 2) return null;

  // First amount = transaction amount; last amount (when > 1) = running balance
  const txAmount = amounts[0];
  const balance = amounts.length >= 2 ? amounts[amounts.length - 1] : undefined;

  // Derive direction from description keywords; default to inflow
  const upper = description.toUpperCase();
  let direction: 'inflow' | 'outflow' = 'inflow';

  if (
    /\b(DEBIT|DR\b|WITHDRAWAL|WITHDRAW|PAYMENT|PAID|PURCHASE|TRANSFER OUT|OUTFLOW|FEE|CHARGE|DEDUCTED|SENT|OUTGOING)\b/.test(
      upper,
    )
  ) {
    direction = 'outflow';
  } else if (
    /\b(CREDIT|CR\b|DEPOSIT|SALARY|PAYROLL|RECEIVED|INFLOW|COLLECTION|REMITTANCE|REFUND|INCOMING)\b/.test(
      upper,
    )
  ) {
    direction = 'inflow';
  }

  const tx: NormalizedTransaction = { date, description, amount: txAmount, direction };
  if (balance !== undefined) tx.balance = balance;

  tx.channel = detectChannel(description);
  const category = detectCategory(description, direction);
  if (category) tx.category = category;
  const beneficiaryId = extractBeneficiaryId(description);
  if (beneficiaryId) tx.beneficiaryId = beneficiaryId;
  const country = detectCountry(description);
  if (country) tx.country = country;

  return tx;
}

export function streamToBuffer(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks)));
  });
}
