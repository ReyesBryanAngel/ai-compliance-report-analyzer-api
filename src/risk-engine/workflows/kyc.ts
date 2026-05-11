import { NormalizedTransaction } from '../../parser/types';
import { WorkflowResult } from '../types';
import { computeOverallScore } from '../scoring';
import { checkRecurringSalary } from '../checkpoints/recurring-salary';
import { checkIncomeConsistency } from '../checkpoints/income-consistency';

export function runKyc(transactions: NormalizedTransaction[]): WorkflowResult {
  const findings = [
    checkRecurringSalary(transactions),
    checkIncomeConsistency(transactions),
  ];

  return {
    workflow: 'kyc',
    overallScore: computeOverallScore(findings),
    findings,
  };
}
