import { NumericTransaction, RiskFinding } from '../types';

const MIN_SAMPLE = 10;

function isRound(amount: number): boolean {
  return Number.isInteger(amount) || amount % 1 === 0;
}

export function checkRoundAmountConcentration(
  transactions: NumericTransaction[],
): RiskFinding {
  const eligible = transactions.filter((tx) => tx.amount > 0);

  if (eligible.length < MIN_SAMPLE) {
    return {
      checkpoint: 'round-amount-concentration',
      triggered: false,
      severity: 'low',
      score: 0,
      reason: `Too few transactions (${eligible.length}) for round-amount analysis — minimum ${MIN_SAMPLE} required`,
      evidence: [],
    };
  }

  const roundTxs = eligible.filter((tx) => isRound(tx.amount));
  const ratio = roundTxs.length / eligible.length;
  const pct = (ratio * 100).toFixed(1);

  if (ratio < 0.6) {
    return {
      checkpoint: 'round-amount-concentration',
      triggered: false,
      severity: 'low',
      score: 10,
      reason: `Round-amount concentration within normal range (${pct}% whole-number amounts)`,
      evidence: [],
    };
  }

  if (ratio < 0.75) {
    return {
      checkpoint: 'round-amount-concentration',
      triggered: true,
      severity: 'medium',
      score: 55,
      reason: `Elevated round-amount concentration (${pct}%) — unusually high proportion of whole-number transactions`,
      evidence: roundTxs,
    };
  }

  if (ratio < 0.90) {
    return {
      checkpoint: 'round-amount-concentration',
      triggered: true,
      severity: 'high',
      score: 75,
      reason: `High round-amount concentration (${pct}%) — majority of transactions lack cent values, suggesting manual fabrication`,
      evidence: roundTxs,
    };
  }

  return {
    checkpoint: 'round-amount-concentration',
    triggered: true,
    severity: 'high',
    score: 90,
    reason: `Extreme round-amount concentration (${pct}%) — nearly all transactions are whole numbers, strong fabrication indicator`,
    evidence: roundTxs,
  };
}
