import { NumericTransaction, RiskFinding } from '../types';

const MIN_SAMPLE = 50;

// Benford's expected frequency for each leading digit d: log10(1 + 1/d)
const BENFORD: Record<number, number> = {
  1: Math.log10(2),        // ~0.30103
  2: Math.log10(3 / 2),    // ~0.17609
  3: Math.log10(4 / 3),    // ~0.12494
  4: Math.log10(5 / 4),    // ~0.09691
  5: Math.log10(6 / 5),    // ~0.07918
  6: Math.log10(7 / 6),    // ~0.06695
  7: Math.log10(8 / 7),    // ~0.05799
  8: Math.log10(9 / 8),    // ~0.05115
  9: Math.log10(10 / 9),   // ~0.04576
};

function leadingDigit(amount: number): number | null {
  if (amount <= 0) return null;
  const normalized = amount / Math.pow(10, Math.floor(Math.log10(amount)));
  return Math.floor(normalized);
}

export function checkAmountDigitDistribution(
  transactions: NumericTransaction[],
): RiskFinding {
  const eligible = transactions.filter((tx) => tx.amount > 0);

  if (eligible.length < MIN_SAMPLE) {
    return {
      checkpoint: 'amount-digit-distribution',
      triggered: false,
      severity: 'low',
      score: 0,
      reason: `Too few transactions (${eligible.length}) for Benford's analysis — minimum ${MIN_SAMPLE} required`,
      evidence: [],
    };
  }

  const counts: Record<number, number> = { 1:0,2:0,3:0,4:0,5:0,6:0,7:0,8:0,9:0 };
  const byDigit: Record<number, NumericTransaction[]> = { 1:[],2:[],3:[],4:[],5:[],6:[],7:[],8:[],9:[] };

  for (const tx of eligible) {
    const d = leadingDigit(tx.amount);
    if (d !== null && d >= 1 && d <= 9) {
      counts[d]++;
      byDigit[d].push(tx);
    }
  }

  const total = Object.values(counts).reduce((sum, c) => sum + c, 0);

  let mad = 0;
  let maxDeviation = -Infinity;
  let mostDeviantDigit = 1;

  for (let d = 1; d <= 9; d++) {
    const observed = counts[d] / total;
    const expected = BENFORD[d];
    mad += Math.abs(observed - expected);
    const deviation = observed - expected;
    if (deviation > maxDeviation) {
      maxDeviation = deviation;
      mostDeviantDigit = d;
    }
  }
  mad /= 9;

  const madLabel = mad.toFixed(4);

  if (mad < 0.006) {
    return {
      checkpoint: 'amount-digit-distribution',
      triggered: false,
      severity: 'low',
      score: 10,
      reason: `Digit distribution conforms to Benford's Law (MAD ${madLabel})`,
      evidence: [],
    };
  }

  const evidence = byDigit[mostDeviantDigit];

  if (mad < 0.012) {
    return {
      checkpoint: 'amount-digit-distribution',
      triggered: true,
      severity: 'medium',
      score: 55,
      reason: `Acceptable deviation from Benford's Law (MAD ${madLabel}) — digit '${mostDeviantDigit}' over-represented`,
      evidence,
    };
  }

  if (mad < 0.015) {
    return {
      checkpoint: 'amount-digit-distribution',
      triggered: true,
      severity: 'high',
      score: 75,
      reason: `Nonconforming digit distribution (MAD ${madLabel}) — digit '${mostDeviantDigit}' significantly over-represented`,
      evidence,
    };
  }

  return {
    checkpoint: 'amount-digit-distribution',
    triggered: true,
    severity: 'high',
    score: 90,
    reason: `Fraud-suspect digit distribution (MAD ${madLabel}) — digit '${mostDeviantDigit}' severely over-represented`,
    evidence,
  };
}
