import { NumericTransaction, RiskFinding } from '../types';
import { applyThreshold, isGamblingTx, ThresholdBand } from './gambling-utils';

export function checkGamblingOverdrafts(
  transactions: NumericTransaction[],
  band: ThresholdBand,
): RiskFinding {
  // An overdraft caused by gambling: a gambling outflow where the post-transaction
  // balance is negative. Requires the `balance` field to be present on the transaction.
  const overdrafts = transactions.filter(
    (tx) => tx.direction === 'outflow' && isGamblingTx(tx) && tx.balance !== undefined && tx.balance < 0,
  );

  return applyThreshold(
    overdrafts.length,
    band,
    'gambling-overdrafts',
    'Overdrafts due to gambling',
    overdrafts,
  );
}
