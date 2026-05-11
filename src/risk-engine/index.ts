import { NormalizedTransaction } from '../parser/types';
import { RiskReport } from './types';
import { runKyc } from './workflows';

export type { RiskFinding, RiskReport, WorkflowResult } from './types';
export { runKyc, SUPPORTED_WORKFLOWS } from './workflows';
export type { SupportedWorkflow } from './workflows';

export function runRiskEngine(
  transactions: NormalizedTransaction[],
  workflows: string[],
): RiskReport {
  const results = [];
  if (workflows.includes('kyc')) results.push(runKyc(transactions));
  return { workflows: results };
}
