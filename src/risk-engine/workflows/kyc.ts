import { NormalizedTransaction } from '../../parser/types';
import { WorkflowResult } from '../types';
import { computeOverallScore } from '../scoring';
import { checkRecurringSalary } from '../checkpoints/recurring-salary';
import { checkIncomeConsistency } from '../checkpoints/income-consistency';

export function runKyc(
  transactions: NormalizedTransaction[],
  enabledCheckpoints?: Set<string>,
): WorkflowResult {
  const enabled = (slug: string) => !enabledCheckpoints || enabledCheckpoints.has(slug);
  const findings = [
    ...(enabled('recurring-salary') ? [checkRecurringSalary(transactions)] : []),
    ...(enabled('income-consistency') ? [checkIncomeConsistency(transactions)] : []),
  ];

  return {
    workflow: 'kyc',
    overallScore: computeOverallScore(findings),
    findings,
  };
}
