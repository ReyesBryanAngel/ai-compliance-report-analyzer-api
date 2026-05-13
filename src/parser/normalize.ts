import type { NormalizedTransaction } from './types';

// ── Column alias tables ──────────────────────────────────────────────────────

const DATE_ALIASES = [
  'date', 'transaction date', 'txn date', 'trans date', 'value date',
  'posting date', 'trans. date', 'transaction dt',
];

const DESCRIPTION_ALIASES = [
  'description', 'particulars', 'narrative', 'memo', 'details',
  'transaction details', 'remarks', 'payee', 'beneficiary', 'note', 'notes',
];

const AMOUNT_ALIASES = [
  'amount', 'transaction amount', 'txn amount', 'trans amount',
];

const DEBIT_ALIASES = [
  'debit', 'debit amount', 'withdrawal', 'withdrawals', 'dr', 'dr amount',
];

const CREDIT_ALIASES = [
  'credit', 'credit amount', 'deposit', 'deposits', 'cr', 'cr amount',
];

const BALANCE_ALIASES = [
  'balance', 'running balance', 'available balance', 'ledger balance',
  'closing balance', 'bal',
];

const REFERENCE_ALIASES = [
  'reference', 'ref', 'ref no', 'reference no', 'reference number',
  'transaction id', 'txn id', 'trans id', 'check no', 'cheque no',
  'trace no', 'receipt no',
];

const CURRENCY_ALIASES = [
  'currency', 'ccy', 'cur',
];

// ── Column finder ────────────────────────────────────────────────────────────

export function findColumn(headers: string[], aliases: string[]): string | undefined {
  const normalized = headers.map((h) => h.toLowerCase().trim());
  for (const alias of aliases) {
    const idx = normalized.indexOf(alias.toLowerCase());
    if (idx !== -1) return headers[idx];
  }
  return undefined;
}

export function detectColumns(headers: string[]) {
  return {
    date:        findColumn(headers, DATE_ALIASES),
    description: findColumn(headers, DESCRIPTION_ALIASES),
    amount:      findColumn(headers, AMOUNT_ALIASES),
    debit:       findColumn(headers, DEBIT_ALIASES),
    credit:      findColumn(headers, CREDIT_ALIASES),
    balance:     findColumn(headers, BALANCE_ALIASES),
    reference:   findColumn(headers, REFERENCE_ALIASES),
    currency:    findColumn(headers, CURRENCY_ALIASES),
  };
}

// ── Value parsers ────────────────────────────────────────────────────────────

export function parseAmount(raw: string | undefined): number | null {
  if (!raw || raw.trim() === '' || raw.trim() === '-') return null;

  const trimmed = raw.trim();
  // Parentheses notation: (1,234.56) means negative
  const isNegative = trimmed.startsWith('(') && trimmed.endsWith(')');
  const cleaned = trimmed.replace(/[(),\s$₱€£¥]/g, '').replace(/,/g, '');
  const num = parseFloat(cleaned);

  if (isNaN(num)) return null;
  return isNegative ? -Math.abs(num) : num;
}

const MONTH_MAP: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

export function parseDate(raw: string | undefined): string | null {
  if (!raw || raw.trim() === '') return null;
  const s = raw.trim();

  // YYYY-MM-DD or YYYY/MM/DD
  const isoMatch = s.match(/^(\d{4})[-/](\d{2})[-/](\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

  // DD-Mon-YYYY or DD Mon YYYY  e.g. 15-Jan-2024
  const namedMatch = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3})[-\s](\d{4})/);
  if (namedMatch) {
    const month = MONTH_MAP[namedMatch[2].toLowerCase()];
    if (month) return `${namedMatch[3]}-${month}-${namedMatch[1].padStart(2, '0')}`;
  }

  // MM/DD/YYYY or DD/MM/YYYY — resolve ambiguity by value
  const slashMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (slashMatch) {
    const a = parseInt(slashMatch[1]);
    const b = parseInt(slashMatch[2]);
    const y = slashMatch[3];
    if (a > 12) {
      // Must be DD/MM/YYYY
      return `${y}-${slashMatch[2].padStart(2, '0')}-${slashMatch[1].padStart(2, '0')}`;
    }
    // Default MM/DD/YYYY (US convention)
    return `${y}-${slashMatch[1].padStart(2, '0')}-${slashMatch[2].padStart(2, '0')}`;
  }

  // Fallback to Date constructor
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];

  return null;
}

// ── Enrichment ───────────────────────────────────────────────────────────────

const PHONE_RE = /\b(09\d{2}[-\s]?\d{3}[-\s]?\d{4}|\+639\d{9})\b/;
const ACCOUNT_RE = /(?<!\d)(\d{10,16})(?!\d)/;
const BENEFICIARY_NOISE =
  /\b(transfer|trf|fund|to|from|via|instapay|pesonet|rtgs|swift|wire|bdo|bpi|metrobank|unionbank|rcbc|pnb|gcash|paymaya|maya|grabpay|shopeepay|bank|online|mobile|send|receive|payment|pay|remit|remittance|interbank|peso|net|account|acct|no|ref|the|and|for|of|a)\b/gi;

export function extractBeneficiaryId(description: string): string | undefined {
  const phoneMatch = description.match(PHONE_RE);
  if (phoneMatch) return `phone:${phoneMatch[1].replace(/[-\s]/g, '')}`;

  const acctMatch = description.match(ACCOUNT_RE);
  if (acctMatch) return `acct:${acctMatch[1]}`;

  const name = description
    .toLowerCase()
    .replace(BENEFICIARY_NOISE, ' ')
    .replace(/\d+/g, ' ')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return name.length >= 3 ? `name:${name}` : undefined;
}

export function detectChannel(description: string): NormalizedTransaction['channel'] {
  const d = description.toUpperCase();
  if (/\bATM\b/.test(d)) return 'atm';
  if (/\b(GCASH|PAYMAYA|MAYA|GRABPAY|SHOPEEPAY|PAYPAL|COINS\.PH|COINSPH)\b/.test(d)) return 'ewallet';
  if (/\b(WIRE|SWIFT|INSTAPAY|PESONET|RTGS|REMITTANCE|REMIT|FUND TRANSFER|INTERBANK)\b/.test(d)) return 'transfer';
  if (/\b(TRF|TRANSFER)\b/.test(d)) return 'transfer';
  if (/\b(POS|PURCHASE|MERCHANT|DEBIT CARD|CREDIT CARD|CONTACTLESS)\b/.test(d)) return 'card';
  return 'bank';
}

export function detectCategory(description: string, direction: 'inflow' | 'outflow'): string | undefined {
  const d = description.toUpperCase();
  if (/\b(SALARY|PAYROLL|COMPENSATION|PAY SLIP)\b/.test(d)) return 'salary';
  if (/\b(ATM|CASH WITHDRAWAL|CASH WD)\b/.test(d)) return 'cash_withdrawal';
  if (/\b(LOAN|AMORTIZATION|MORTGAGE|LENDING)\b/.test(d)) return 'loan_payment';
  if (/\b(UTILITIES|MERALCO|MAYNILAD|WATER|ELECTRIC|PLDT|GLOBE|CONVERGE|CIGNAL)\b/.test(d)) return 'utilities';
  if (/\b(INTEREST|DIVIDEND)\b/.test(d)) return direction === 'inflow' ? 'interest_income' : 'interest_expense';
  if (/\b(TRANSFER|REMITTANCE|REMIT)\b/.test(d)) return 'transfer';
  if (/\b(PURCHASE|POS|MERCHANT|SHOPPING)\b/.test(d)) return 'purchase';
  if (/\b(INSURANCE|PREMIUM)\b/.test(d)) return 'insurance';
  if (/\b(TAX|BIR|SSS|PHILHEALTH|PAGIBIG|HDMF)\b/.test(d)) return 'tax_or_contribution';
  return undefined;
}
