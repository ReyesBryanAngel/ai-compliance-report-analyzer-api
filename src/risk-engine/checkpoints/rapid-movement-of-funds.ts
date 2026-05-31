import { NumericTransaction, RiskFinding } from '../types';
import { applyThreshold } from './gambling-utils';

export type RapidMovementThresholds = {
  /** Rolling window size in hours over which transaction velocity is measured. */
  windowHours: number;
  /** Total amount moved within the window required to flag it as a high-velocity window. */
  velocityThreshold: number;
  /** Number of flagged windows at or below which the checkpoint is not triggered (green zone). */
  greenMax: number;
  /** Number of flagged windows at or below which the severity is medium (amber zone); above is high. */
  amberMax: number;
};

export const RAPID_MOVEMENT_DEFAULTS: RapidMovementThresholds = {
  windowHours: 24,
  velocityThreshold: 50_000,
  greenMax: 0,
  amberMax: 2,
};

export function checkRapidMovementOfFunds(
  transactions: NumericTransaction[],
  thresholds: RapidMovementThresholds = RAPID_MOVEMENT_DEFAULTS,
): RiskFinding {
  const { windowHours, velocityThreshold, greenMax, amberMax } = thresholds;

  const sorted = [...transactions].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );

  const windowMs = windowHours * 60 * 60 * 1000;
  const flaggedEvidence: NumericTransaction[] = [];
  let flaggedWindows = 0;

  // For each transaction, treat it as the anchor of a forward-looking window.
  // Count distinct windows that exceed the velocity threshold.
  // Two anchors that would produce overlapping windows (start times within windowMs) are merged.
  let lastWindowStart = -Infinity;

  for (const anchor of sorted) {
    const t0 = new Date(anchor.date).getTime();

    // Skip if this anchor falls inside an already-counted window.
    if (t0 < lastWindowStart + windowMs) continue;

    const windowTxs = sorted.filter(t => {
      const dt = new Date(t.date).getTime() - t0;
      return dt >= 0 && dt <= windowMs;
    });

    const totalMoved = windowTxs.reduce((s, t) => s + t.amount, 0);

    if (totalMoved >= velocityThreshold) {
      flaggedWindows++;
      lastWindowStart = t0;
      flaggedEvidence.push(...windowTxs);
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
    flaggedWindows,
    { greenMax, amberMax },
    'rapid-movement-of-funds',
    `High-velocity windows (≥${velocityThreshold.toLocaleString()} moved within ${windowHours}h)`,
    evidence,
  );
}
