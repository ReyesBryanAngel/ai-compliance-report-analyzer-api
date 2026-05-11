import { NormalizedTransaction } from '../../parser/types';
import { RiskFinding } from '../types';
import { applyThreshold, isGamblingTx, ThresholdBand } from './gambling-utils';

export function checkGamblingDays(
  transactions: NormalizedTransaction[],
  band: ThresholdBand,
): RiskFinding {
  const gamblingTxns = transactions.filter(isGamblingTx);
  const uniqueDays = new Set(gamblingTxns.map((tx) => tx.date.slice(0, 10))).size;

  return applyThreshold(
    uniqueDays,
    band,
    'gambling-days',
    `Gambling days count`,
    gamblingTxns,
  );
}
