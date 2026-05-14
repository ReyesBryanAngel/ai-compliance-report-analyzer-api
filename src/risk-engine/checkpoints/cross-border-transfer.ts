import { NormalizedTransaction } from '../../parser/types';
import { RiskFinding } from '../types';
import { applyThreshold } from './gambling-utils';
import { jurisdictionRisk } from '../data/high-risk-countries';

export type CrossBorderThresholds = {
  /** Minimum transaction amount (PHP) to include in scoring; filters out trivial FX fees. */
  minAmount: number;
  /** Rolling window in days used to detect currency-mixing patterns. */
  currencyMixWindowDays: number;
  /** Number of distinct foreign currencies within the window that constitutes a mixing flag. */
  currencyMixMinDistinct: number;
  /** Number of flagged events at or below which the checkpoint is not triggered (green zone). */
  greenMax: number;
  /** Number of flagged events at or below which the severity is medium (amber zone); above is high. */
  amberMax: number;
};

export const CROSS_BORDER_DEFAULTS: CrossBorderThresholds = {
  minAmount: 10_000,
  currencyMixWindowDays: 30,
  currencyMixMinDistinct: 3,
  greenMax: 2,
  amberMax: 5,
};

export function checkCrossBorderTransfer(
  transactions: NormalizedTransaction[],
  thresholds: CrossBorderThresholds = CROSS_BORDER_DEFAULTS,
): RiskFinding {
  const { minAmount, currencyMixWindowDays, currencyMixMinDistinct, greenMax, amberMax } = thresholds;

  // ── Phase 1: FATF blacklist ────────────────────────────────────────────────
  // Immediate high-severity return; no threshold grace applies.
  const blacklistTxs = transactions.filter(
    t => t.country && t.amount >= minAmount && jurisdictionRisk(t.country) === 'blacklist',
  );

  if (blacklistTxs.length > 0) {
    const countries = [...new Set(blacklistTxs.map(t => t.country))].join(', ');
    return {
      checkpoint: 'cross-border-transfer',
      triggered: true,
      severity: 'high',
      score: 100,
      reason: `${blacklistTxs.length} transaction(s) linked to FATF-blacklisted jurisdiction(s): ${countries}. Immediate AML escalation required.`,
      evidence: blacklistTxs,
    };
  }

  // ── Phase 2: Greylist / offshore / EU-blacklist transactions ──────────────
  // Count each qualifying foreign transaction as one flagged event.
  const riskTiers: Record<'greylist' | 'offshore' | 'eu-blacklist', string[]> = {
    greylist: [],
    offshore: [],
    'eu-blacklist': [],
  };
  const jurisdictionTxs: NormalizedTransaction[] = [];

  for (const t of transactions) {
    if (!t.country || t.amount < minAmount) continue;
    const tier = jurisdictionRisk(t.country);
    if (tier === 'none' || tier === 'blacklist') continue;
    riskTiers[tier].push(t.country);
    jurisdictionTxs.push(t);
  }

  let flaggedCount = jurisdictionTxs.length;

  // ── Phase 3: Currency-mixing signal ───────────────────────────────────────
  // Rapid rotation through multiple foreign currencies within a rolling window
  // is a layering indicator (obscuring fund origin via FX conversion).
  const foreignTxs = transactions
    .filter(t => t.currency && t.currency !== 'PHP' && t.amount >= minAmount)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const windowMs = currencyMixWindowDays * 24 * 60 * 60 * 1000;
  let lastMixWindowStart = -Infinity;
  const mixEvidence: NormalizedTransaction[] = [];

  for (const anchor of foreignTxs) {
    const t0 = new Date(anchor.date).getTime();
    if (t0 < lastMixWindowStart + windowMs) continue;

    const windowTxs = foreignTxs.filter(t => {
      const dt = new Date(t.date).getTime() - t0;
      return dt >= 0 && dt <= windowMs;
    });

    const distinctCurrencies = new Set(windowTxs.map(t => t.currency)).size;
    if (distinctCurrencies >= currencyMixMinDistinct) {
      flaggedCount++;
      lastMixWindowStart = t0;
      mixEvidence.push(...windowTxs);
    }
  }

  // ── Deduplication ─────────────────────────────────────────────────────────
  const seen = new Set<string>();
  const allEvidence = [...jurisdictionTxs, ...mixEvidence].filter(t => {
    const key = `${t.date}-${t.amount}-${t.description}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // ── Reason string ─────────────────────────────────────────────────────────
  const parts: string[] = [];
  const greylistCountries = [...new Set(riskTiers.greylist)];
  const offshoreCountries = [...new Set(riskTiers.offshore)];
  const euBlacklistCountries = [...new Set(riskTiers['eu-blacklist'])];

  if (greylistCountries.length) parts.push(`FATF greylist (${greylistCountries.join(', ')})`);
  if (offshoreCountries.length) parts.push(`offshore haven (${offshoreCountries.join(', ')})`);
  if (euBlacklistCountries.length) parts.push(`EU tax blacklist (${euBlacklistCountries.join(', ')})`);
  if (mixEvidence.length) parts.push(`currency mixing ≥${currencyMixMinDistinct} currencies/${currencyMixWindowDays}d`);

  const metricLabel = parts.length
    ? `Cross-border risk events — ${parts.join('; ')}`
    : `Cross-border transactions ≥ PHP ${minAmount.toLocaleString()}`;

  return applyThreshold(
    flaggedCount,
    { greenMax, amberMax },
    'cross-border-transfer',
    metricLabel,
    allEvidence,
  );
}
