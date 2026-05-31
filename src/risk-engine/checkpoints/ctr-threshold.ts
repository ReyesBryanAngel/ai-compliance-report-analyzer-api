import { NumericTransaction, RiskFinding } from '../types';
import { applyThreshold } from './gambling-utils';

export type CtrThresholds = {
  /** Single transaction amount at or above which a CTR must be filed (default: PHP 500,000 per AMLC). */
  singleTxLimit: number;
  /** Daily aggregate amount at or above which sub-threshold transactions collectively trigger a CTR. */
  dailyAggregateLimit: number;
  /** Number of CTR breach events at or below which the checkpoint is not triggered (green zone). */
  greenMax: number;
  /** Number of CTR breach events at or below which the severity is medium (amber zone); above is high. */
  amberMax: number;
};

export const CTR_DEFAULTS: CtrThresholds = {
  singleTxLimit: 500_000,
  dailyAggregateLimit: 500_000,
  greenMax: 0,
  amberMax: 2,
};

export function checkCtrThreshold(
  transactions: NumericTransaction[],
  thresholds: CtrThresholds = CTR_DEFAULTS,
): RiskFinding {
  const { singleTxLimit, dailyAggregateLimit, greenMax, amberMax } = thresholds;

  const evidence: NumericTransaction[] = [];
  let breachCount = 0;

  // Phase 1: individual transactions that independently breach the reporting threshold.
  const singleBreaches = transactions.filter(t => t.amount >= singleTxLimit);
  breachCount += singleBreaches.length;
  evidence.push(...singleBreaches);

  // Phase 2: days where the aggregate of sub-threshold transactions reaches the limit.
  // Only transactions already below singleTxLimit are considered here to avoid double-counting
  // days that were already flagged via single-transaction breaches.
  const subThreshold = transactions.filter(t => t.amount < singleTxLimit);

  const byDay = new Map<string, NumericTransaction[]>();
  for (const tx of subThreshold) {
    const day = tx.date.slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push(tx);
  }

  for (const dayTxs of byDay.values()) {
    const total = dayTxs.reduce((s, t) => s + t.amount, 0);
    if (total >= dailyAggregateLimit) {
      breachCount++;
      evidence.push(...dayTxs);
    }
  }

  const seen = new Set<string>();
  const dedupedEvidence = evidence.filter(t => {
    const key = `${t.date}-${t.amount}-${t.description}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return applyThreshold(
    breachCount,
    { greenMax, amberMax },
    'ctr-threshold',
    `CTR breach events (single tx ≥ ${singleTxLimit.toLocaleString()} or daily aggregate of sub-threshold txs ≥ ${dailyAggregateLimit.toLocaleString()})`,
    dedupedEvidence,
  );
}
