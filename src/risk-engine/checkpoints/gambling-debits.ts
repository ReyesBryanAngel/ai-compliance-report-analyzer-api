import { NumericTransaction, RiskFinding } from '../types';
import { applyThreshold, isGamblingTx, ThresholdBand } from './gambling-utils';

export function checkGamblingDebits(
  transactions: NumericTransaction[],
  band: ThresholdBand,
): RiskFinding {
  const debits = transactions.filter(
    (tx) => tx.direction === 'outflow' && isGamblingTx(tx),
  );

  return applyThreshold(
    debits.length,
    band,
    'gambling-debits',
    `Gambling debit count`,
    debits,
  );
}
