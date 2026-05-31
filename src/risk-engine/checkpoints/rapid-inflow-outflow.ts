import { NumericTransaction, RiskFinding } from '../types';
import { applyThreshold } from './gambling-utils';

export type RapidInflowOutflowThresholds = {
  /** How long after an inflow to watch for matching outflows. */
  windowHours: number;
  /** Fraction of the inflow amount that must exit within the window to count as a cycle (0–1). */
  drainRatio: number;
  /**
   * Minimum inflow amount to consider. Filters out small everyday transactions
   * (e.g. groceries followed by a coffee) that would otherwise match the math
   * but are not meaningful AML signals.
   */
  minInflow: number;
  /** Cycle count at or below which the checkpoint is not triggered (green zone). */
  greenMax: number;
  /** Cycle count at or below which the severity is medium (amber zone); above is high. */
  amberMax: number;
};

export const RAPID_INFLOW_OUTFLOW_DEFAULTS: RapidInflowOutflowThresholds = {
  windowHours: 72,
  drainRatio: 0.8,
  minInflow: 5_000,
  greenMax: 0,
  amberMax: 1,
};

export function checkRapidInflowOutflow(
  transactions: NumericTransaction[],
  thresholds: RapidInflowOutflowThresholds = RAPID_INFLOW_OUTFLOW_DEFAULTS,
): RiskFinding {
  const { windowHours, drainRatio, minInflow, greenMax, amberMax } = thresholds;

  const sorted = [...transactions].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );

  const inflows = sorted.filter(t => t.direction === 'inflow' && t.amount >= minInflow);
  const outflows = sorted.filter(t => t.direction === 'outflow');

  const windowMs = windowHours * 60 * 60 * 1000;
  const cycleEvidence: NumericTransaction[] = [];
  let cycles = 0;

  for (const inflow of inflows) {
    const t0 = new Date(inflow.date).getTime();
    const windowOutflows = outflows.filter(t => {
      const dt = new Date(t.date).getTime() - t0;
      return dt >= 0 && dt <= windowMs;
    });

    const drained = windowOutflows.reduce((s, t) => s + t.amount, 0);
    if (drained >= inflow.amount * drainRatio) {
      cycles++;
      cycleEvidence.push(inflow, ...windowOutflows);
    }
  }

  const seen = new Set<string>();
  const evidence = cycleEvidence.filter(t => {
    const key = `${t.date}-${t.amount}-${t.description}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return applyThreshold(
    cycles,
    { greenMax, amberMax },
    'rapid-inflow-outflow',
    `Rapid inflow/outflow cycles (≥${drainRatio * 100}% drain within ${windowHours}h)`,
    evidence,
  );
}
