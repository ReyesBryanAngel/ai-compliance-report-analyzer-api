import { NumericTransaction, RiskFinding } from '../types';
import { applyThreshold, ThresholdBand } from './gambling-utils';

const ROUNDING_TOLERANCE = 1.0;

export type BalanceDiscrepancyParams = ThresholdBand & {
  openingBalance?: number;
};

export const BALANCE_DISCREPANCY_DEFAULTS: BalanceDiscrepancyParams = {
  greenMax: 0,
  amberMax: 2,
};

export function checkStatementBalanceDiscrepancy(
  transactions: NumericTransaction[],
  params: BalanceDiscrepancyParams = BALANCE_DISCREPANCY_DEFAULTS,
): RiskFinding {
  const withBalance = transactions.filter((tx) => tx.balance !== undefined);

  if (withBalance.length < 2) {
    return {
      checkpoint: 'statement-balance-discrepancy',
      triggered: false,
      severity: 'low',
      score: 0,
      reason: 'Insufficient balance data — checkpoint skipped',
      evidence: [],
    };
  }

  const sorted = [...withBalance].sort((a, b) => a.date.localeCompare(b.date));

  // --- Per-row running balance check ---
  // Checks each consecutive pair; recalibrates to reported balance on discrepancy
  // so each mismatch is counted independently rather than cascading.
  const discrepant: NumericTransaction[] = [];
  let expectedBalance = sorted[0].balance!;

  for (let i = 1; i < sorted.length; i++) {
    const tx = sorted[i];
    const delta = tx.direction === 'inflow' ? tx.amount : -tx.amount;
    expectedBalance += delta;
    const reportedBalance = tx.balance!;

    if (Math.abs(reportedBalance - expectedBalance) > ROUNDING_TOLERANCE) {
      discrepant.push(tx);
      expectedBalance = reportedBalance;
    }
  }

  // --- End-to-end balance validation ---
  // Applies all transaction deltas from the first recorded balance without
  // recalibration to detect cumulative drift — catches cases where small
  // within-tolerance row errors compound into a meaningful total mismatch.
  let endToEndMismatch = false;
  let endToEndReason = '';
  {
    let running = sorted[0].balance!;
    for (let i = 1; i < sorted.length; i++) {
      const tx = sorted[i];
      running += tx.direction === 'inflow' ? tx.amount : -tx.amount;
    }
    const lastReported = sorted[sorted.length - 1].balance!;
    if (Math.abs(lastReported - running) > ROUNDING_TOLERANCE) {
      endToEndMismatch = true;
      endToEndReason = `Ending balance mismatch: computed ${running.toFixed(2)}, reported ${lastReported.toFixed(2)}`;
    }
  }

  // --- Opening balance validation ---
  // If the document supplies an explicit opening balance, verifies that applying
  // the first transaction's delta to it produces the first recorded row balance.
  let openingMismatch = false;
  let openingReason = '';
  const { openingBalance } = params;
  if (openingBalance !== undefined) {
    const first = sorted[0];
    const delta = first.direction === 'inflow' ? first.amount : -first.amount;
    const expectedFirstBalance = openingBalance + delta;
    if (Math.abs(first.balance! - expectedFirstBalance) > ROUNDING_TOLERANCE) {
      openingMismatch = true;
      const sign = first.direction === 'inflow' ? '+' : '−';
      openingReason =
        `Opening balance mismatch: stated ${openingBalance.toFixed(2)} ${sign} ${first.amount.toFixed(2)} = ${expectedFirstBalance.toFixed(2)}, ` +
        `first recorded balance is ${first.balance!.toFixed(2)}`;
    }
  }

  // Base result driven by the per-row discrepancy count
  const base = applyThreshold(
    discrepant.length,
    params,
    'statement-balance-discrepancy',
    'Balance discrepancies (reported vs computed)',
    discrepant,
  );

  if (!endToEndMismatch && !openingMismatch) return base;

  // Any structural mismatch (end-to-end or opening balance) is a high-severity
  // forgery indicator regardless of the per-row count.
  const extraReasons: string[] = [];
  if (endToEndMismatch) extraReasons.push(endToEndReason);
  if (openingMismatch) extraReasons.push(openingReason);

  const combinedReason = discrepant.length > 0
    ? `${base.reason}; ${extraReasons.join('; ')}`
    : extraReasons.join('; ');

  return {
    checkpoint: 'statement-balance-discrepancy',
    triggered: true,
    severity: 'high',
    score: 90,
    reason: combinedReason,
    evidence: discrepant,
  };
}
