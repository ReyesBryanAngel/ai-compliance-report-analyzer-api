import { NormalizedTransaction } from '../../parser/types';
import { RiskFinding } from '../types';

const SALARY_PATTERNS = [
  /\bsalary\b/i,
  /\bpayroll\b/i,
  /\bpayslip\b/i,
  /\bsweldo\b/i,
  /\bwages\b/i,
  /\bstipend\b/i,
  /\bremuneration\b/i,
  /\bpension\b/i,
  /\bgsis\b/i,
  /\bsss\s+benefit\b/i,
];

// ─── helpers ─────────────────────────────────────────────────────────────────

function isSalaryInflow(tx: NormalizedTransaction): boolean {
  if (tx.direction !== 'inflow') return false;
  if (tx.category === 'salary') return true;
  return SALARY_PATTERNS.some(p => p.test(tx.description));
}

function groupByMonth(txns: NormalizedTransaction[]): Record<string, NormalizedTransaction[]> {
  return txns.reduce<Record<string, NormalizedTransaction[]>>((acc, tx) => {
    const month = tx.date.slice(0, 7);
    (acc[month] ??= []).push(tx);
    return acc;
  }, {});
}

function stddev(values: number[]): number {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length);
}

// ─── individual signals ───────────────────────────────────────────────────────

// Signal 1 — keyword match (weight: 30)
// Any transaction already matched the salary merchant dictionary.
function signalKeyword(salaryTxns: NormalizedTransaction[]): boolean {
  return salaryTxns.length > 0;
}

// Signal 2 — recurring day-of-month pattern (weight: 25)
// Salary lands on a consistent day (e.g. every 15th/30th). End-of-month dates
// (28–31) are normalised to 28 so they don't inflate variance.
function signalMonthlyPattern(salaryTxns: NormalizedTransaction[]): boolean {
  if (salaryTxns.length < 2) return false;
  const days = salaryTxns.map(tx => {
    const d = parseInt(tx.date.slice(8, 10), 10);
    return d >= 28 ? 28 : d;
  });
  return stddev(days) <= 5;
}

// Signal 3 — stable amount (weight: 20)
// CV of the peak monthly salary credit is ≤ 10 % — roughly ±₱4.5k on ₱45k.
function signalStableAmount(monthlyPeak: number[]): boolean {
  if (monthlyPeak.length < 2) return false;
  const mean = monthlyPeak.reduce((a, b) => a + b, 0) / monthlyPeak.length;
  return stddev(monthlyPeak) / mean <= 0.1;
}

// Signal 4 — consistent sender name (weight: 15)
// A single word (≥ 4 chars) from the description appears in ≥ 70 % of months —
// proxy for the same employer/payer each cycle.
function signalConsistentSender(
  salaryTxns: NormalizedTransaction[],
  monthCount: number,
): boolean {
  const wordMonths: Record<string, Set<string>> = {};
  for (const tx of salaryTxns) {
    const month = tx.date.slice(0, 7);
    const words = tx.description.toUpperCase().match(/\b[A-Z]{4,}\b/g) ?? [];
    for (const word of words) {
      (wordMonths[word] ??= new Set()).add(month);
    }
  }
  const maxCoverage = Math.max(...Object.values(wordMonths).map(s => s.size), 0);
  return maxCoverage / monthCount >= 0.7;
}

// Signal 5 — bank/transfer channel (weight: 10)
// Salary via payroll typically arrives as a bank credit or inter-bank transfer,
// not via an e-wallet top-up or ATM deposit.
function signalBankChannel(salaryTxns: NormalizedTransaction[]): boolean {
  if (salaryTxns.length === 0) return false;
  const bankCount = salaryTxns.filter(
    tx => tx.channel === 'bank' || tx.channel === 'transfer',
  ).length;
  return bankCount / salaryTxns.length >= 0.5;
}

// ─── confidence aggregation ───────────────────────────────────────────────────

const SIGNAL_WEIGHTS = {
  keyword: 30,
  monthlyPattern: 25,
  stableAmount: 20,
  consistentSender: 15,
  bankChannel: 10,
} as const;

function computeSalaryConfidence(
  salaryTxns: NormalizedTransaction[],
  byMonth: Record<string, NormalizedTransaction[]>,
  months: string[],
): number {
  const monthlyPeak = months.map(m => Math.max(...byMonth[m].map(tx => tx.amount)));

  let confidence = 0;
  if (signalKeyword(salaryTxns)) confidence += SIGNAL_WEIGHTS.keyword;
  if (signalMonthlyPattern(salaryTxns)) confidence += SIGNAL_WEIGHTS.monthlyPattern;
  if (signalStableAmount(monthlyPeak)) confidence += SIGNAL_WEIGHTS.stableAmount;
  if (signalConsistentSender(salaryTxns, months.length)) confidence += SIGNAL_WEIGHTS.consistentSender;
  if (signalBankChannel(salaryTxns)) confidence += SIGNAL_WEIGHTS.bankChannel;

  return confidence; // 0–100
}

// ─── checkpoint ───────────────────────────────────────────────────────────────

export function checkRecurringSalary(transactions: NormalizedTransaction[]): RiskFinding {
  const salaryTxns = transactions.filter(isSalaryInflow);
  const byMonth = groupByMonth(salaryTxns);
  const months = Object.keys(byMonth).sort();

  if (months.length === 0) {
    return {
      checkpoint: 'recurring-salary',
      triggered: true,
      severity: 'high',
      score: 90,
      reason: 'No salary-related inflows detected',
      evidence: [],
    };
  }

  const confidence = computeSalaryConfidence(salaryTxns, byMonth, months);
  const riskScore = Math.round(100 - confidence);

  if (confidence >= 70) {
    return {
      checkpoint: 'recurring-salary',
      triggered: false,
      severity: 'low',
      score: riskScore,
      reason: `Salary confirmed — ${confidence}% confidence across ${months.length} month${months.length > 1 ? 's' : ''}`,
      evidence: salaryTxns,
    };
  }

  if (confidence >= 40) {
    return {
      checkpoint: 'recurring-salary',
      triggered: true,
      severity: 'medium',
      score: riskScore,
      reason: `Weak salary signal — ${confidence}% confidence (irregular pattern, amount variance, or unknown sender)`,
      evidence: salaryTxns,
    };
  }

  return {
    checkpoint: 'recurring-salary',
    triggered: true,
    severity: 'high',
    score: riskScore,
    reason: `Low salary confidence — ${confidence}% (missing day-of-month pattern, stable amount, and consistent sender)`,
    evidence: salaryTxns,
  };
}
