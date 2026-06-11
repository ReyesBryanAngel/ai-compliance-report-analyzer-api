import { NumericTransaction } from '../types';
import { WorkflowResult } from '../types';
import { computeOverallScore } from '../scoring';
import { checkRecurringSalary } from '../checkpoints/recurring-salary';
import { checkIncomeConsistency } from '../checkpoints/income-consistency';
import { checkLoanStacking } from '../checkpoints/loan-stacking';
import { checkLowBalancePersistence } from '../checkpoints/low-balance-persistence';
import { checkRoundAmountConcentration } from '../checkpoints/round-amount-concentration';
import { checkSourceOfFunds, SourceOfFundsThresholds, SOURCE_OF_FUNDS_DEFAULTS } from '../checkpoints/source-of-funds';
import { ThresholdBand } from '../checkpoints/gambling-utils';

export type KycThresholds = {
  'loan-stacking': ThresholdBand;
  'low-balance-persistence': ThresholdBand;
  'source-of-funds': SourceOfFundsThresholds;
};

export const KYC_DEFAULT_THRESHOLDS: KycThresholds = {
  'loan-stacking': { greenMax: 1, amberMax: 2 },
  'low-balance-persistence': { greenMax: 1, amberMax: 3 },
  'source-of-funds': SOURCE_OF_FUNDS_DEFAULTS,
};

export function runKyc(
  transactions: NumericTransaction[],
  enabledCheckpoints?: Set<string>,
  thresholds: Partial<KycThresholds> = {},
): WorkflowResult {
  const resolved: KycThresholds = { ...KYC_DEFAULT_THRESHOLDS, ...thresholds };
  const enabled = (slug: string) => !enabledCheckpoints || enabledCheckpoints.has(slug);

  const findings = [
    ...(enabled('recurring-salary') ? [checkRecurringSalary(transactions)] : []),
    ...(enabled('income-consistency') ? [checkIncomeConsistency(transactions)] : []),
    ...(enabled('loan-stacking') ? [checkLoanStacking(transactions, resolved['loan-stacking'])] : []),
    ...(enabled('low-balance-persistence') ? [checkLowBalancePersistence(transactions, resolved['low-balance-persistence'])] : []),
    ...(enabled('round-amount-concentration') ? [checkRoundAmountConcentration(transactions)] : []),
    ...(enabled('source-of-funds') ? [checkSourceOfFunds(transactions, resolved['source-of-funds'])] : []),
  ];

  return {
    workflow: 'kyc',
    overallScore: computeOverallScore(findings),
    findings,
  };
}
