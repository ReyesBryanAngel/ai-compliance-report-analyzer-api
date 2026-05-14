/**
 * Jurisdiction risk reference data.
 *
 * Sources:
 *   FATF blacklist / high-risk jurisdictions  — fatf-gafi.org (updated Feb 2025)
 *   FATF greylist / increased monitoring       — fatf-gafi.org (updated Feb 2025)
 *   Offshore / secrecy jurisdictions           — OECD, EU non-cooperative jurisdictions list, FSF
 *
 * Philippines (PH) appears on the FATF greylist. It is the home jurisdiction
 * for this system, so the checkpoint treats it as baseline — not as an
 * inbound foreign-risk signal. Keep it in the set for completeness so that
 * outbound transfers to other greylist countries are scored consistently.
 */

// ── FATF Blacklist ─────────────────────────────────────────────────────────
// "Call for action" — highest risk; subject to counter-measures.
export const FATF_BLACKLIST = new Set<string>([
  'IR', // Iran
  'KP', // North Korea (DPRK)
  'MM', // Myanmar
]);

// ── FATF Greylist ──────────────────────────────────────────────────────────
// "Increased monitoring" — committed to action plan; elevated scrutiny required.
export const FATF_GREYLIST = new Set<string>([
  'DZ', // Algeria
  'AO', // Angola
  'BG', // Bulgaria
  'BF', // Burkina Faso
  'CM', // Cameroon
  'CI', // Côte d'Ivoire
  'CD', // Congo, DRC
  'HT', // Haiti
  'KE', // Kenya
  'LA', // Lao PDR
  'LB', // Lebanon
  'ML', // Mali
  'MC', // Monaco
  'MZ', // Mozambique
  'NA', // Namibia
  'NG', // Nigeria
  'PH', // Philippines
  'ZA', // South Africa
  'SS', // South Sudan
  'SY', // Syria
  'TZ', // Tanzania
  'VN', // Vietnam
  'YE', // Yemen
]);

// ── Offshore / Secrecy Jurisdictions ──────────────────────────────────────
// Known offshore financial centres, tax havens, or low-transparency jurisdictions
// commonly used for layering and structuring. Not necessarily sanctioned but
// warrant enhanced due diligence on any transfer.
export const OFFSHORE_HAVENS = new Set<string>([
  'VG', // British Virgin Islands
  'KY', // Cayman Islands
  'PA', // Panama
  'CH', // Switzerland
  'LI', // Liechtenstein
  'MC', // Monaco (also on FATF greylist)
  'JE', // Jersey
  'GG', // Guernsey
  'IM', // Isle of Man
  'BS', // Bahamas
  'BZ', // Belize
  'SC', // Seychelles
  'MU', // Mauritius
  'MO', // Macao
  'CW', // Curaçao
  'AN', // Netherlands Antilles (legacy ISO code still seen in old statements)
  'TC', // Turks and Caicos Islands
  'AG', // Antigua and Barbuda
  'DM', // Dominica
  'KN', // Saint Kitts and Nevis
  'VC', // Saint Vincent and the Grenadines
  'WS', // Samoa
  'VU', // Vanuatu
  'CK', // Cook Islands
  'NR', // Nauru
  'PW', // Palau
  'MS', // Montserrat
  'BM', // Bermuda
  'GI', // Gibraltar
  'AD', // Andorra
  'SM', // San Marino
]);

// ── EU Non-Cooperative Jurisdictions (blacklist, as of 2025) ──────────────
// EU tax blacklist — distinct from FATF but overlaps; relevant for EUR-leg transfers.
export const EU_TAX_BLACKLIST = new Set<string>([
  'AS', // American Samoa
  'AO', // Angola
  'AG', // Antigua and Barbuda
  'BS', // Bahamas
  'BZ', // Belize
  'FJ', // Fiji
  'GU', // Guam
  'PW', // Palau
  'PA', // Panama
  'RU', // Russia
  'SC', // Seychelles
  'TC', // Turks and Caicos
  'VI', // US Virgin Islands
  'VU', // Vanuatu
  'WS', // Samoa
]);

// ── Combined High-Risk Set ─────────────────────────────────────────────────
// Union of all lists above — use for broad "is this jurisdiction high-risk?" checks.
export const ALL_HIGH_RISK_COUNTRIES = new Set<string>([
  ...FATF_BLACKLIST,
  ...FATF_GREYLIST,
  ...OFFSHORE_HAVENS,
  ...EU_TAX_BLACKLIST,
]);

export type JurisdictionRisk = 'blacklist' | 'greylist' | 'offshore' | 'eu-blacklist' | 'none';

/**
 * Returns the highest-severity risk classification for a country code.
 * A country can appear on multiple lists; we return the worst tier.
 */
export function jurisdictionRisk(countryCode: string): JurisdictionRisk {
  const code = countryCode.toUpperCase();
  if (FATF_BLACKLIST.has(code)) return 'blacklist';
  if (FATF_GREYLIST.has(code)) return 'greylist';
  if (OFFSHORE_HAVENS.has(code)) return 'offshore';
  if (EU_TAX_BLACKLIST.has(code)) return 'eu-blacklist';
  return 'none';
}
