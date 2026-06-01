import { NumericTransaction, RiskFinding } from '../types';

const MIN_SAMPLE = 10;

// Structured round: multiples of 500 (500, 1000, 1500…) — ATM denominations,
// deliberate bulk transfers; highest fabrication signal.
// Moderately round: multiples of 25/50/100 but not 500 — common bill/load amounts;
// suspicious in high concentration but less so individually.
// Weak: whole number with no recognised round structure (168, 111, 54…) —
// typical of manual P2P transfers in PH; minimal signal on its own.
const STRONG_WEIGHT = 1.0;
const MODERATE_WEIGHT = 0.5;
const WEAK_WEIGHT = 0.15;

function classifyAmount(amount: number): 'strong' | 'moderate' | 'weak' | 'fractional' {
  if (!Number.isInteger(amount)) return 'fractional';
  if (amount % 500 === 0) return 'strong';
  if (amount % 100 === 0 || amount % 50 === 0 || amount % 25 === 0) return 'moderate';
  return 'weak';
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

  const counts = { strong: 0, moderate: 0, weak: 0 };
  const roundTxs: NumericTransaction[] = [];

  for (const tx of eligible) {
    const tier = classifyAmount(tx.amount);
    if (tier !== 'fractional') {
      counts[tier]++;
      roundTxs.push(tx);
    }
  }

  const total = eligible.length;
  const effectiveScore =
    (counts.strong * STRONG_WEIGHT + counts.moderate * MODERATE_WEIGHT + counts.weak * WEAK_WEIGHT) / total;

  const pct = (n: number) => ((n / total) * 100).toFixed(1);
  const breakdown = `structured ${pct(counts.strong)}%, moderately-round ${pct(counts.moderate)}%, whole-irregular ${pct(counts.weak)}%`;

  if (effectiveScore < 0.6) {
    return {
      checkpoint: 'round-amount-concentration',
      triggered: false,
      severity: 'low',
      score: 10,
      reason: `Round-amount concentration within normal range (weighted score ${(effectiveScore * 100).toFixed(1)} — ${breakdown})`,
      evidence: [],
    };
  }

  if (effectiveScore < 0.75) {
    return {
      checkpoint: 'round-amount-concentration',
      triggered: true,
      severity: 'medium',
      score: 55,
      reason: `Elevated round-amount concentration (weighted score ${(effectiveScore * 100).toFixed(1)} — ${breakdown}) — unusually high proportion of structured amounts`,
      evidence: roundTxs,
    };
  }

  if (effectiveScore < 0.90) {
    return {
      checkpoint: 'round-amount-concentration',
      triggered: true,
      severity: 'high',
      score: 75,
      reason: `High round-amount concentration (weighted score ${(effectiveScore * 100).toFixed(1)} — ${breakdown}) — majority of amounts are structured round numbers, suggesting manual entry`,
      evidence: roundTxs,
    };
  }

  return {
    checkpoint: 'round-amount-concentration',
    triggered: true,
    severity: 'high',
    score: 90,
    reason: `Extreme round-amount concentration (weighted score ${(effectiveScore * 100).toFixed(1)} — ${breakdown}) — nearly all transactions are structured whole numbers, strong fabrication indicator`,
    evidence: roundTxs,
  };
}
