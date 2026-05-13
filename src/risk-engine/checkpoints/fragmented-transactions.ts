import { NormalizedTransaction } from '../../parser/types';
import { RiskFinding } from '../types';
import { applyThreshold } from './gambling-utils';

export type FragmentedTransactionThresholds = {
  /** Rolling window in days over which fragments are aggregated. */
  windowDays: number;
  /** Each individual transaction must be strictly below this to be considered a fragment. */
  singleTxnCeiling: number;
  /** The aggregate of all fragments within the window must meet or exceed this to flag the window. */
  aggregateFloor: number;
  /** Minimum number of fragments within the window to constitute a structuring pattern. */
  minFragments: number;
  /** Number of flagged clusters at or below which the checkpoint is not triggered (green zone). */
  greenMax: number;
  /** Number of flagged clusters at or below which the severity is medium (amber zone); above is high. */
  amberMax: number;
};

export const FRAGMENTED_TRANSACTION_DEFAULTS: FragmentedTransactionThresholds = {
  windowDays: 3,
  singleTxnCeiling: 499_000,
  aggregateFloor: 500_000,
  minFragments: 3,
  greenMax: 0,
  amberMax: 1,
};

export function checkFragmentedTransactions(
  transactions: NormalizedTransaction[],
  thresholds: FragmentedTransactionThresholds = FRAGMENTED_TRANSACTION_DEFAULTS,
): RiskFinding {
  const { windowDays, singleTxnCeiling, aggregateFloor, minFragments, greenMax, amberMax } = thresholds;

  const outflows = [...transactions]
    .filter(t => t.direction === 'outflow' && t.amount < singleTxnCeiling)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const windowMs = windowDays * 24 * 60 * 60 * 1000;

  // Group by beneficiaryId (set by the parser). Transactions without one get a
  // unique key so they never form a cluster with unrelated outflows.
  const byBeneficiary = new Map<string, NormalizedTransaction[]>();
  for (const tx of outflows) {
    const key = tx.beneficiaryId ?? `ungrouped:${tx.date}-${tx.amount}-${tx.description}`;
    if (!byBeneficiary.has(key)) byBeneficiary.set(key, []);
    byBeneficiary.get(key)!.push(tx);
  }

  const flaggedEvidence: NormalizedTransaction[] = [];
  let flaggedClusters = 0;

  for (const group of byBeneficiary.values()) {
    let lastWindowStart = -Infinity;

    for (const anchor of group) {
      const t0 = new Date(anchor.date).getTime();

      // Skip anchors inside an already-counted window to prevent double-counting.
      if (t0 < lastWindowStart + windowMs) continue;

      const windowTxs = group.filter(t => {
        const dt = new Date(t.date).getTime() - t0;
        return dt >= 0 && dt <= windowMs;
      });

      const total = windowTxs.reduce((s, t) => s + t.amount, 0);

      if (windowTxs.length >= minFragments && total >= aggregateFloor) {
        flaggedClusters++;
        lastWindowStart = t0;
        flaggedEvidence.push(...windowTxs);
      }
    }
  }

  const seen = new Set<string>();
  const evidence = flaggedEvidence.filter(t => {
    const key = `${t.date}-${t.amount}-${t.description}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return applyThreshold(
    flaggedClusters,
    { greenMax, amberMax },
    'fragmented-transactions',
    `Structuring clusters (≥${minFragments} outflows to same recipient each <${singleTxnCeiling.toLocaleString()} totalling ≥${aggregateFloor.toLocaleString()} within ${windowDays}d)`,
    evidence,
  );
}
