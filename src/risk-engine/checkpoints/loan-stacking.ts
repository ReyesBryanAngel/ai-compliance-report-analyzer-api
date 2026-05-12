import { NormalizedTransaction } from '../../parser/types';
import { RiskFinding } from '../types';
import { applyThreshold, ThresholdBand } from './gambling-utils';

// Loan disbursement patterns: inflows that represent a new credit facility being opened.
// The normalizer already tags description-based LOAN/LENDING/MORTGAGE/AMORTIZATION
// as category='loan_payment'; we catch those on inflow plus explicit fintech/lender names.
const LOAN_DISBURSEMENT_PATTERNS = [
  /\bloan\b/i,
  /\blending\b/i,
  /\bmortgage\b/i,
  /\bamortization\b/i,
  /\bdisbursement\b/i,
  /\bcredit\s+(facility|line|proceeds|release)\b/i,
  /\bpersonal\s+loan\b/i,
  /\bcash\s+loan\b/i,
  // Philippine fintech / consumer lenders
  /\btala\b/i,
  /\bcashalo\b/i,
  /\btonik\b/i,
  /\bhome\s*credit\b/i,
  /\buniondigital\b/i,
  /\bseabank\b/i,
  /\bacom\b/i,
  /\brobinsons\s+bank.*loan\b/i,
  /\bpag.?ibig\s+loan\b/i,
  /\bsss\s+loan\b/i,
  /\bgsis\s+loan\b/i,
];

function isLoanDisbursement(tx: NormalizedTransaction): boolean {
  if (tx.direction !== 'inflow') return false;
  if (tx.category === 'loan_payment') return true;
  return LOAN_DISBURSEMENT_PATTERNS.some((p) => p.test(tx.description));
}

// Returns the transactions that form the largest cluster within any 30-day window.
// A recurring payment from a single loan (one per month) will never exceed 1 within
// any 30-day window, so monthly payments spread across months stay GREEN.
// Concurrent loans taken out close together will pile up and breach AMBER/RED.
function peakWindow(disbursements: NormalizedTransaction[]): NormalizedTransaction[] {
  if (disbursements.length === 0) return [];

  const sorted = [...disbursements].sort((a, b) => a.date.localeCompare(b.date));
  const MS_PER_DAY = 86_400_000;
  const WINDOW_MS = 30 * MS_PER_DAY;

  let best: NormalizedTransaction[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const anchor = new Date(sorted[i].date).getTime();
    const window = sorted.filter(
      (tx) => new Date(tx.date).getTime() - anchor >= 0
           && new Date(tx.date).getTime() - anchor <= WINDOW_MS,
    );
    if (window.length > best.length) best = window;
  }

  return best;
}

export function checkLoanStacking(
  transactions: NormalizedTransaction[],
  band: ThresholdBand,
): RiskFinding {
  const disbursements = transactions.filter(isLoanDisbursement);
  const peak = peakWindow(disbursements);

  return applyThreshold(
    peak.length,
    band,
    'loan-stacking',
    'Peak loan disbursements within 30 days',
    peak,
  );
}
