/**
 * ISO 4217 → ISO 3166-1 alpha-2 mapping.
 *
 * Multi-country currencies use a regional sentinel:
 *   EU  — Eurozone (EUR)
 *   XO  — West African CFA franc zone (XOF)
 *   XA  — Central African CFA franc zone (XAF)
 *   XC  — Eastern Caribbean (XCD)
 *
 * PHP is included so callers can check `currency === 'PHP'` without a
 * separate domestic guard; the checkpoint treats PH as the home jurisdiction.
 */
export const CURRENCY_COUNTRY_MAP: Readonly<Record<string, string>> = {
  // ── Domestic ──────────────────────────────────────────────────────────────
  PHP: 'PH',

  // ── Major / G10 ───────────────────────────────────────────────────────────
  USD: 'US',
  EUR: 'EU',
  GBP: 'GB',
  JPY: 'JP',
  CHF: 'CH',
  AUD: 'AU',
  CAD: 'CA',
  NZD: 'NZ',
  SEK: 'SE',
  NOK: 'NO',
  DKK: 'DK',

  // ── Asia-Pacific ──────────────────────────────────────────────────────────
  SGD: 'SG',
  HKD: 'HK',
  CNY: 'CN',
  CNH: 'CN',
  KRW: 'KR',
  TWD: 'TW',
  THB: 'TH',
  MYR: 'MY',
  IDR: 'ID',
  VND: 'VN',
  BND: 'BN',
  KHR: 'KH',
  LAK: 'LA',
  MMK: 'MM',   // Myanmar — FATF blacklist
  NPR: 'NP',
  LKR: 'LK',
  BDT: 'BD',
  PKR: 'PK',
  INR: 'IN',
  MNT: 'MN',
  KZT: 'KZ',
  UZS: 'UZ',

  // ── Middle East ───────────────────────────────────────────────────────────
  AED: 'AE',
  SAR: 'SA',
  KWD: 'KW',
  QAR: 'QA',
  BHD: 'BH',
  OMR: 'OM',
  JOD: 'JO',
  ILS: 'IL',
  IRR: 'IR',   // Iran — FATF blacklist
  TRY: 'TR',
  LBP: 'LB',   // Lebanon — FATF greylist

  // ── Americas ──────────────────────────────────────────────────────────────
  MXN: 'MX',
  BRL: 'BR',
  ARS: 'AR',
  CLP: 'CL',
  COP: 'CO',
  PEN: 'PE',
  VES: 'VE',
  GTQ: 'GT',
  HNL: 'HN',
  NIO: 'NI',
  CRC: 'CR',
  PAB: 'PA',   // Panama — offshore haven
  BSD: 'BS',   // Bahamas — offshore haven
  BBD: 'BB',
  JMD: 'JM',
  TTD: 'TT',
  KYD: 'KY',   // Cayman Islands — offshore haven
  BMD: 'BM',
  AWG: 'AW',
  ANG: 'CW',   // Netherlands Antilles / Curaçao

  // ── Europe (non-EUR) ──────────────────────────────────────────────────────
  PLN: 'PL',
  HUF: 'HU',
  CZK: 'CZ',
  RON: 'RO',
  BGN: 'BG',   // Bulgaria — FATF greylist
  HRK: 'HR',
  RSD: 'RS',
  UAH: 'UA',
  RUB: 'RU',
  GEL: 'GE',
  AMD: 'AM',
  MDL: 'MD',
  ISK: 'IS',

  // ── Africa ────────────────────────────────────────────────────────────────
  ZAR: 'ZA',   // South Africa — FATF greylist
  NGN: 'NG',   // Nigeria — FATF greylist
  KES: 'KE',   // Kenya — FATF greylist
  GHS: 'GH',
  EGP: 'EG',
  MAD: 'MA',
  TND: 'TN',
  DZD: 'DZ',   // Algeria — FATF greylist
  ETB: 'ET',
  UGX: 'UG',
  TZS: 'TZ',   // Tanzania — FATF greylist
  MZN: 'MZ',   // Mozambique — FATF greylist
  ZMW: 'ZM',
  SCR: 'SC',   // Seychelles — offshore haven
  MUR: 'MU',   // Mauritius — offshore haven
  XOF: 'XO',   // West African CFA (BF, CI, ML, SN, TG, BJ, NE, GW)
  XAF: 'XA',   // Central African CFA (CM, CF, TD, CG, GA, GQ)

  // ── Pacific / other ───────────────────────────────────────────────────────
  FJD: 'FJ',
  PGK: 'PG',
  SBD: 'SB',
  VUV: 'VU',   // Vanuatu — offshore haven
  WST: 'WS',   // Samoa — offshore haven

  // ── North Korea ───────────────────────────────────────────────────────────
  KPW: 'KP',   // FATF blacklist
};

/** Returns the ISO 3166-1 alpha-2 country code for a currency, or undefined. */
export function countryForCurrency(currency: string): string | undefined {
  return CURRENCY_COUNTRY_MAP[currency.toUpperCase()];
}
