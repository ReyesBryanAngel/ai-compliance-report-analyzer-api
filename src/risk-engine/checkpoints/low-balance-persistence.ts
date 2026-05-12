import { NormalizedTransaction } from '../../parser/types';
import { RiskFinding } from '../types';
import { applyThreshold, ThresholdBand } from './gambling-utils';

const LOW_BALANCE_RATIO = 0.20;

export function checkLowBalancePersistence(
  transactions: NormalizedTransaction[],
  band: ThresholdBand,
): RiskFinding {
  const withBalance = transactions.filter((tx) => tx.balance !== undefined);

  if (withBalance.length === 0) {
    return {
      checkpoint: 'low-balance-persistence',
      triggered: false,
      severity: 'low',
      score: 0,
      reason: 'No balance data available — checkpoint skipped',
      evidence: [],
    };
  }

  const inflows = transactions.filter((tx) => tx.direction === 'inflow');
  const inflowByMonth = inflows.reduce<Record<string, number>>((acc, tx) => {
    const month = tx.date.slice(0, 7);
    acc[month] = (acc[month] ?? 0) + tx.amount;
    return acc;
  }, {});
  const inflowMonths = Object.values(inflowByMonth);
  const avgMonthlyInflow =
    inflowMonths.length > 0
      ? inflowMonths.reduce((a, b) => a + b, 0) / inflowMonths.length
      : 0;
  const threshold = avgMonthlyInflow * LOW_BALANCE_RATIO;

  // Last balance snapshot per month (later dates overwrite earlier ones after sort)
  const sorted = [...withBalance].sort((a, b) => a.date.localeCompare(b.date));
  const endOfMonthSnapshot = sorted.reduce<Record<string, NormalizedTransaction>>(
    (acc, tx) => {
      acc[tx.date.slice(0, 7)] = tx;
      return acc;
    },
    {},
  );

  const lowBalanceMonths = Object.values(endOfMonthSnapshot).filter(
    (tx) => (tx.balance as number) < threshold,
  );

  return applyThreshold(
    lowBalanceMonths.length,
    band,
    'low-balance-persistence',
    'Months with end-of-month balance below 20% of avg monthly inflow',
    lowBalanceMonths,
  );
}
