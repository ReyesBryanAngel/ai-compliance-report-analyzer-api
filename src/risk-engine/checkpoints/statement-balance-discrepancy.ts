import { NormalizedTransaction } from '../../parser/types';
import { RiskFinding } from '../types';
import { applyThreshold, ThresholdBand } from './gambling-utils';

const ROUNDING_TOLERANCE = 1.0;

export const BALANCE_DISCREPANCY_DEFAULTS: ThresholdBand = {
  greenMax: 0,
  amberMax: 2,
};

export function checkStatementBalanceDiscrepancy(
  transactions: NormalizedTransaction[],
  band: ThresholdBand = BALANCE_DISCREPANCY_DEFAULTS,
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
  const discrepant: NormalizedTransaction[] = [];

  let expectedBalance = sorted[0].balance as number;

  for (let i = 1; i < sorted.length; i++) {
    const tx = sorted[i];
    const delta = tx.direction === 'inflow' ? tx.amount : -tx.amount;
    expectedBalance += delta;
    const reportedBalance = tx.balance as number;

    if (Math.abs(reportedBalance - expectedBalance) > ROUNDING_TOLERANCE) {
      discrepant.push(tx);
      // Recalibrate to reported balance so each discrepancy is counted independently
      expectedBalance = reportedBalance;
    }
  }

  return applyThreshold(
    discrepant.length,
    band,
    'statement-balance-discrepancy',
    'Balance discrepancies (reported vs computed)',
    discrepant,
  );
}
