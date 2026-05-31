import { NumericTransaction, RiskFinding } from '../types';

// ─── helpers ─────────────────────────────────────────────────────────────────

function groupByMonth(txns: NumericTransaction[]): Record<string, NumericTransaction[]> {
  return txns.reduce<Record<string, NumericTransaction[]>>((acc, tx) => {
    const month = tx.date.slice(0, 7);
    (acc[month] ??= []).push(tx);
    return acc;
  }, {});
}

function stddev(values: number[]): number {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length);
}

// Linear regression slope normalised by mean — positive means growing income,
// negative means declining. Returns a value in roughly [-1, +1].
function trendSlope(totals: number[]): number {
  const n = totals.length;
  const meanX = (n - 1) / 2;
  const meanY = totals.reduce((a, b) => a + b, 0) / n;
  const ssX = totals.reduce((acc, _, i) => acc + (i - meanX) ** 2, 0);
  if (ssX === 0) return 0;
  const slope = totals.reduce((acc, y, i) => acc + (i - meanX) * (y - meanY), 0) / ssX;
  return slope / meanY; // relative slope per month
}

type Trend = 'growing' | 'stable' | 'declining';

function classifyTrend(totals: number[]): Trend {
  if (totals.length < 3) return 'stable';
  const rel = trendSlope(totals);
  if (rel > 0.05) return 'growing';
  if (rel < -0.05) return 'declining';
  return 'stable';
}

// ─── checkpoint ───────────────────────────────────────────────────────────────

export function checkIncomeConsistency(transactions: NumericTransaction[]): RiskFinding {
  const inflows = transactions.filter(tx => tx.direction === 'inflow');
  const byMonth = groupByMonth(inflows);
  const months = Object.keys(byMonth).sort();

  if (months.length < 2) {
    return {
      checkpoint: 'income-consistency',
      triggered: false,
      severity: 'low',
      score: 0,
      reason: 'Insufficient data — fewer than 2 months of inflow history',
      evidence: [],
    };
  }

  const monthlyTotals = months.map(m =>
    byMonth[m].reduce((sum, tx) => sum + tx.amount, 0),
  );
  const mean = monthlyTotals.reduce((a, b) => a + b, 0) / monthlyTotals.length;
  const cv = stddev(monthlyTotals) / mean;
  const trend = classifyTrend(monthlyTotals);

  const trendNote =
    trend === 'growing'
      ? ' Income trend is upward.'
      : trend === 'declining'
        ? ' Income trend is declining — additional risk.'
        : '';

  // Declining income increases severity by one level
  const decliningPenalty = trend === 'declining' ? 1 : 0;

  if (cv > 0.5) {
    const severityLevels = ['medium', 'high'] as const;
    return {
      checkpoint: 'income-consistency',
      triggered: true,
      severity: severityLevels[decliningPenalty],
      score: Math.min(100, 75 + decliningPenalty * 10),
      reason: `Highly variable income — CV ${(cv * 100).toFixed(0)}% across ${months.length} months.${trendNote}`,
      evidence: inflows,
    };
  }

  if (cv > 0.25) {
    const severityLevels = ['low', 'medium'] as const;
    return {
      checkpoint: 'income-consistency',
      triggered: trend === 'declining' ? true : true,
      severity: severityLevels[decliningPenalty],
      score: 40 + decliningPenalty * 15,
      reason: `Moderately variable income — CV ${(cv * 100).toFixed(0)}% across ${months.length} months.${trendNote}`,
      evidence: inflows,
    };
  }

  return {
    checkpoint: 'income-consistency',
    triggered: false,
    severity: 'low',
    score: trend === 'declining' ? 20 : 10,
    reason: `Income is consistent — CV ${(cv * 100).toFixed(0)}% across ${months.length} months.${trendNote}`,
    evidence: inflows,
  };
}
