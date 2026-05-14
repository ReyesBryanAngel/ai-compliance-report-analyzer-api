import type { NormalizedTransaction } from './types';
import { countryForCurrency } from '../risk-engine/data/currency-country-map';

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

const COUNTRY_ALIASES = [
  'country', 'country code', 'origin country', 'originating country',
  'sender country', 'source country', 'destination country', 'recipient country',
  'remittance country', 'counterparty country',
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
    country:     findColumn(headers, COUNTRY_ALIASES),
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

// ── Country detection ────────────────────────────────────────────────────────

// IBAN always starts with 2 uppercase letters + 2 digits + ≥4 alphanumerics.
const IBAN_RE = /\b([A-Z]{2})\d{2}[A-Z0-9]{4,}\b/;

// SWIFT BIC: 4-char bank code + 2-char country + 2-char location [+ 3-char branch]
// e.g. BOFAUS3N, DBSSSGSG, AAAAGB2L
const SWIFT_RE = /\b[A-Z]{4}([A-Z]{2})[A-Z0-9]{2}(?:[A-Z0-9]{3})?\b/;

// Description keyword → ISO 3166-1 alpha-2
// Ordered from most-specific to least-specific to avoid false positives.
const DESCRIPTION_COUNTRY_PATTERNS: [RegExp, string][] = [
  // Sanctioned / blacklist — check first
  [/\b(IRAN|TEHRAN|IRR)\b/, 'IR'],
  [/\b(NORTH\s*KOREA|DPRK|KPW)\b/, 'KP'],
  [/\b(MYANMAR|BURMA|RANGOON|YANGON|MMK)\b/, 'MM'],

  // Offshore havens
  [/\b(CAYMAN|CAYMAN\s*ISLANDS?|KYD)\b/, 'KY'],
  [/\b(BRITISH\s*VIRGIN|BVI)\b/, 'VG'],
  [/\b(PANAMA)\b/, 'PA'],
  [/\b(SEYCHELLES?)\b/, 'SC'],
  [/\b(MAURITIUS)\b/, 'MU'],
  [/\b(BERMUDA)\b/, 'BM'],
  [/\b(BAHAMAS?)\b/, 'BS'],
  [/\b(BELIZE)\b/, 'BZ'],
  [/\b(VANUATU)\b/, 'VU'],
  [/\b(SAMOA)\b/, 'WS'],

  // Asia-Pacific
  [/\b(SINGAPORE|SGP|SGD)\b/, 'SG'],
  [/\b(HONG\s*KONG|HONGKONG|HKG|HKD)\b/, 'HK'],
  [/\b(CHINA|MAINLAND|RENMINBI|RMB|CNY|CNH)\b/, 'CN'],
  [/\b(JAPAN|TOKYO|JPY)\b/, 'JP'],
  [/\b(SOUTH\s*KOREA|KOREA|SEOUL|KRW)\b/, 'KR'],
  [/\b(TAIWAN|TAIPEI|TWD)\b/, 'TW'],
  [/\b(AUSTRALIA|SYDNEY|MELBOURNE|AUD)\b/, 'AU'],
  [/\b(NEW\s*ZEALAND|NZD)\b/, 'NZ'],
  [/\b(MALAYSIA|KUALA\s*LUMPUR|MYR)\b/, 'MY'],
  [/\b(INDONESIA|JAKARTA|IDR)\b/, 'ID'],
  [/\b(VIETNAM|VIET\s*NAM|HANOI|HO\s*CHI\s*MINH|VND)\b/, 'VN'],
  [/\b(THAILAND|BANGKOK|THB)\b/, 'TH'],
  [/\b(INDIA|MUMBAI|DELHI|INR)\b/, 'IN'],
  [/\b(BANGLADESH|DHAKA|BDT)\b/, 'BD'],
  [/\b(SRI\s*LANKA|COLOMBO|LKR)\b/, 'LK'],
  [/\b(PAKISTAN|KARACHI|PKR)\b/, 'PK'],
  [/\b(MACAO|MACAU|MOP)\b/, 'MO'],

  // Middle East
  [/\b(UAE|DUBAI|ABU\s*DHABI|EMIRATES|AED)\b/, 'AE'],
  [/\b(SAUDI|SAUDI\s*ARABIA|KSA|RIYADH|SAR)\b/, 'SA'],
  [/\b(KUWAIT|KWD)\b/, 'KW'],
  [/\b(QATAR|DOHA|QAR)\b/, 'QA'],
  [/\b(BAHRAIN|BHD)\b/, 'BH'],
  [/\b(OMAN|MUSCAT|OMR)\b/, 'OM'],
  [/\b(LEBANON|BEIRUT|LBP)\b/, 'LB'],

  // Americas
  [/\b(UNITED\s*STATES|USA|U\.S\.A\.?|US\s*DOLLAR|USD)\b/, 'US'],
  [/\b(CANADA|TORONTO|VANCOUVER|CAD)\b/, 'CA'],
  [/\b(MEXICO|MEXICAN|MXN)\b/, 'MX'],
  [/\b(BRAZIL|BRASIL|SAO\s*PAULO|BRL)\b/, 'BR'],

  // Europe
  [/\b(UNITED\s*KINGDOM|UK\b|BRITAIN|LONDON|GBP|STERLING)\b/, 'GB'],
  [/\b(SWITZERLAND|SWISS|ZURICH|GENEVA|CHF)\b/, 'CH'],
  [/\b(EURO(?:ZONE)?|EUR)\b/, 'EU'],

  // Africa
  [/\b(NIGERIA|LAGOS|NGN)\b/, 'NG'],
  [/\b(SOUTH\s*AFRICA|JOHANNESBURG|ZAR)\b/, 'ZA'],
  [/\b(KENYA|NAIROBI|KES)\b/, 'KE'],
];

/**
 * Infers the counterparty country (ISO 3166-1 alpha-2) from available signals,
 * in priority order:
 *   1. Explicit currency code → currency-country map
 *   2. IBAN prefix in the description
 *   3. SWIFT BIC country segment in the description
 *   4. Description keyword patterns
 *
 * Returns undefined when the transaction is domestic (PHP / PH) or when no
 * signal is found. The CSV parser also passes through an explicit `country`
 * column value before calling this function, so this is only a fallback.
 */
export function detectCountry(
  description: string,
  currency?: string,
): string | undefined {
  // 1. Currency code — most reliable when present
  if (currency) {
    const mapped = countryForCurrency(currency);
    if (mapped && mapped !== 'PH') return mapped;
    if (mapped === 'PH') return undefined; // domestic
  }

  const upper = description.toUpperCase();

  // 2. IBAN prefix
  const ibanMatch = upper.match(IBAN_RE);
  if (ibanMatch && ibanMatch[1] !== 'PH') return ibanMatch[1];

  // 3. SWIFT BIC country segment
  const swiftMatch = upper.match(SWIFT_RE);
  if (swiftMatch && swiftMatch[1] !== 'PH') return swiftMatch[1];

  // 4. Description keywords
  for (const [pattern, country] of DESCRIPTION_COUNTRY_PATTERNS) {
    if (pattern.test(upper)) return country;
  }

  return undefined;
}
