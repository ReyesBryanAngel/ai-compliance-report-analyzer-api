import { NumericTransaction, RiskFinding } from '../types';
import { applyThreshold } from './gambling-utils';

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
  transactions: NumericTransaction[],
  thresholds: CrossBorderThresholds = CROSS_BORDER_DEFAULTS,
): RiskFinding {
  const { minAmount, currencyMixWindowDays, currencyMixMinDistinct, greenMax, amberMax } = thresholds;

  // Detect currency-mixing: rapid rotation through multiple foreign currencies within a rolling window.
  const foreignTxs = transactions
    .filter(t => t.currency && t.currency !== 'PHP' && t.amount >= minAmount)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const windowMs = currencyMixWindowDays * 24 * 60 * 60 * 1000;
  let lastMixWindowStart = -Infinity;
  let flaggedCount = 0;
  const mixEvidence: NumericTransaction[] = [];

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

  const seen = new Set<string>();
  const allEvidence = mixEvidence.filter(t => {
    const key = `${t.date}-${t.amount}-${t.description}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const metricLabel = mixEvidence.length
    ? `Currency mixing ≥${currencyMixMinDistinct} currencies/${currencyMixWindowDays}d`
    : `Cross-border transactions ≥ PHP ${minAmount.toLocaleString()}`;

  return applyThreshold(
    flaggedCount,
    { greenMax, amberMax },
    'cross-border-transfer',
    metricLabel,
    allEvidence,
  );
}
