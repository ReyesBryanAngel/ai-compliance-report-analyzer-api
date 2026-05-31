import { NumericTransaction, RiskFinding } from '../types';
import { applyThreshold, isGamblingTx, ThresholdBand } from './gambling-utils';

export function checkGamblingActivity(
  transactions: NumericTransaction[],
  band: ThresholdBand,
): RiskFinding {
  const gamblingTxns = transactions.filter(isGamblingTx);

  return applyThreshold(
    gamblingTxns.length,
    band,
    'gambling-activity',
    `Total gambling activity count`,
    gamblingTxns,
  );
}
