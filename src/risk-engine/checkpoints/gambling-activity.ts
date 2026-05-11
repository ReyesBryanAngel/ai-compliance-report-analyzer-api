import { NormalizedTransaction } from '../../parser/types';
import { RiskFinding } from '../types';
import { applyThreshold, isGamblingTx, ThresholdBand } from './gambling-utils';

export function checkGamblingActivity(
  transactions: NormalizedTransaction[],
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
