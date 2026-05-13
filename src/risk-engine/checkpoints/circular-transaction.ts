import { NormalizedTransaction } from '../../parser/types';
import { RiskFinding } from '../types';
import { applyThreshold } from './gambling-utils';

export type CircularTransactionThresholds = {
  /** Hours after an outflow to search for a matching return inflow. */
  windowHours: number;
  /** Maximum fractional difference between outflow and return inflow amounts (0–1). */
  amountTolerance: number;
  /** Minimum outflow amount to consider; filters out small everyday transactions. */
  minAmount: number;
  /** Match count at or below which the checkpoint is not triggered (green zone). */
  greenMax: number;
  /** Match count at or below which the severity is medium (amber zone); above is high. */
  amberMax: number;
};

export const CIRCULAR_TRANSACTION_DEFAULTS: CircularTransactionThresholds = {
  windowHours: 72,
  amountTolerance: 0.05,
  minAmount: 5_000,
  greenMax: 0,
  amberMax: 1,
};

export function checkCircularTransaction(
  transactions: NormalizedTransaction[],
  thresholds: CircularTransactionThresholds = CIRCULAR_TRANSACTION_DEFAULTS,
): RiskFinding {
  const { windowHours, amountTolerance, minAmount, greenMax, amberMax } = thresholds;

  const sorted = [...transactions].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );

  const windowMs = windowHours * 60 * 60 * 1000;

  const outflows = sorted.filter(t => t.direction === 'outflow' && t.amount >= minAmount);
  // Inflows that could be returns; matched ones are removed from the pool to prevent double-counting.
  const inflows = sorted.filter(t => t.direction === 'inflow' && t.amount >= minAmount);
  const matchedInflowIndices = new Set<number>();

  const evidence: NormalizedTransaction[] = [];
  let matches = 0;

  for (const outflow of outflows) {
    const t0 = new Date(outflow.date).getTime();

    for (let i = 0; i < inflows.length; i++) {
      if (matchedInflowIndices.has(i)) continue;

      const inflow = inflows[i];
      const dt = new Date(inflow.date).getTime() - t0;

      // Inflow must occur after the outflow and within the window.
      if (dt < 0 || dt > windowMs) continue;

      const diff = Math.abs(inflow.amount - outflow.amount) / outflow.amount;
      if (diff <= amountTolerance) {
        matches++;
        matchedInflowIndices.add(i);
        evidence.push(outflow, inflow);
        break;
      }
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
    matches,
    { greenMax, amberMax },
    'circular-transaction',
    `Round-trip matches (outflow returned within ${windowHours}h at ±${amountTolerance * 100}% amount tolerance)`,
    dedupedEvidence,
  );
}
