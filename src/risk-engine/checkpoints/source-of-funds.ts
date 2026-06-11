import { NumericTransaction, RiskFinding } from '../types';

// ─── known source patterns ────────────────────────────────────────────────────

// Parser-assigned categories on inflows that constitute an explained source.
const EXPLAINED_CATEGORIES = new Set([
  'salary',
  'transfer',        // remittance / fund transfer tagged by parser
  'interest_income',
  'loan_payment',    // inflow tagged loan_payment = loan proceeds received
]);

// Keyword patterns that identify a known inflow source when the parser left
// category undefined. Ordered from most specific to least specific.
const SOF_PATTERNS: RegExp[] = [
  // Employment income
  /\b(salary|payroll|payslip|sweldo|wages?|stipend|remuneration|compensation)\b/i,
  // Government benefits
  /\b(gsis|sss[\s_]benefit|pension|4ps|dswd|pagibig[\s_]benefit|philhealth[\s_]benefit)\b/i,
  // Overseas remittance
  /\b(remittance|padala|western[\s_]union|moneygram|wise|xoom|ria[\s_]money|ofw|forex[\s_]receipt)\b/i,
  // Business / freelance income
  /\b(invoice|collection|receivable|payment[\s_]received|freelance|professional[\s_]fee|consultation[\s_]fee|service[\s_]fee|sales[\s_]proceed)\b/i,
  // Investment / passive income
  /\b(interest|dividend|investment[\s_]return|stock[\s_]proceed|redemption|maturity[\s_]proceed)\b/i,
  // Refunds and reversals
  /\b(refund|reversal|chargeback|reimbursement|rebate|cashback)\b/i,
  // Rental income
  /\b(rental[\s_]income|rent[\s_]received|landlord[\s_]payment)\b/i,
  // Intra-bank / own-account transfers
  /\b(fund[\s_]transfer|instapay|pesonet|rtgs|own[\s_]account|inter[\s-]?bank|swift[\s_]receipt)\b/i,
  // Loan proceeds
  /\b(loan[\s_]proceed|loan[\s_]release|loan[\s_]disbursement|credit[\s_]proceed)\b/i,
];

function isExplainedInflow(tx: NumericTransaction): boolean {
  if (tx.category && EXPLAINED_CATEGORIES.has(tx.category)) return true;
  return SOF_PATTERNS.some(p => p.test(tx.description));
}

// ─── types ────────────────────────────────────────────────────────────────────

export type SourceOfFundsThresholds = {
  /** Inflow above this floor with no identified source is a large unexplained deposit. */
  largeDepositFloor: number;
  /** Unexplained inflow ratio at or below which the checkpoint is not triggered (green zone). */
  greenRatioMax: number;
  /** Unexplained inflow ratio at or below which severity is medium; above is high. */
  amberRatioMax: number;
  /** Large unexplained deposit count at or below which that signal stays low. */
  largeDepositGreenMax: number;
  /** Large unexplained deposit count at or below which severity is medium; above is high. */
  largeDepositAmberMax: number;
  /** Minimum total inflow (PHP) required to evaluate; below this the result is inconclusive. */
  minTotalInflow: number;
};

export const SOURCE_OF_FUNDS_DEFAULTS: SourceOfFundsThresholds = {
  largeDepositFloor: 50_000,
  greenRatioMax: 0.2,
  amberRatioMax: 0.5,
  largeDepositGreenMax: 0,
  largeDepositAmberMax: 2,
  minTotalInflow: 10_000,
};

// ─── helpers ──────────────────────────────────────────────────────────────────

type SeverityLevel = 0 | 1 | 2; // 0=low, 1=medium, 2=high

const SEVERITY_LABELS = ['low', 'medium', 'high'] as const;
const SEVERITY_SCORES = [10, 55, 85] as const;

function ratioLevel(ratio: number, t: SourceOfFundsThresholds): SeverityLevel {
  if (ratio <= t.greenRatioMax) return 0;
  if (ratio <= t.amberRatioMax) return 1;
  return 2;
}

function largeDepositLevel(count: number, t: SourceOfFundsThresholds): SeverityLevel {
  if (count <= t.largeDepositGreenMax) return 0;
  if (count <= t.largeDepositAmberMax) return 1;
  return 2;
}

// ─── checkpoint ───────────────────────────────────────────────────────────────

export function checkSourceOfFunds(
  transactions: NumericTransaction[],
  thresholds: SourceOfFundsThresholds = SOURCE_OF_FUNDS_DEFAULTS,
): RiskFinding {
  const inflows = transactions.filter(tx => tx.direction === 'inflow');
  const totalInflowAmount = inflows.reduce((s, tx) => s + tx.amount, 0);

  if (totalInflowAmount < thresholds.minTotalInflow) {
    return {
      checkpoint: 'source-of-funds',
      triggered: false,
      severity: 'low',
      score: 0,
      reason: `Insufficient inflow data — total inflows PHP ${totalInflowAmount.toLocaleString()} below minimum threshold of PHP ${thresholds.minTotalInflow.toLocaleString()}`,
      evidence: [],
    };
  }

  const unexplained = inflows.filter(tx => !isExplainedInflow(tx));
  const unexplainedAmount = unexplained.reduce((s, tx) => s + tx.amount, 0);
  const unexplainedRatio = unexplainedAmount / totalInflowAmount;
  const largeUnexplained = unexplained.filter(tx => tx.amount >= thresholds.largeDepositFloor);

  const level = Math.max(
    ratioLevel(unexplainedRatio, thresholds),
    largeDepositLevel(largeUnexplained.length, thresholds),
  ) as SeverityLevel;

  const triggered = level > 0;
  const severity = SEVERITY_LABELS[level];
  const score = SEVERITY_SCORES[level];
  const pct = (unexplainedRatio * 100).toFixed(0);

  const reason = triggered
    ? `Source of funds unclear — ${pct}% of inflows (PHP ${unexplainedAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })}) have no identifiable source; ${largeUnexplained.length} large deposit${largeUnexplained.length !== 1 ? 's' : ''} ≥ PHP ${thresholds.largeDepositFloor.toLocaleString()} unexplained`
    : `Source of funds adequate — only ${pct}% of inflows (PHP ${unexplainedAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })}) are unclassified`;

  return {
    checkpoint: 'source-of-funds',
    triggered,
    severity,
    score,
    reason,
    evidence: unexplained,
  };
}
