import { NormalizedTransaction } from '../parser/types';
import { RiskReport } from './types';
import { runKyc, runSg } from './workflows';
import type { KycThresholds, SgThresholds } from './workflows';

export type { RiskFinding, RiskReport, WorkflowResult } from './types';
export { runKyc, runSg, SUPPORTED_WORKFLOWS } from './workflows';
export type { SupportedWorkflow, KycThresholds, SgThresholds } from './workflows';

export type RiskEngineThresholds = {
  kyc?: Partial<KycThresholds>;
  sg?: Partial<SgThresholds>;
};

export type RiskEngineOptions = {
  thresholds?: RiskEngineThresholds;
  /** Checkpoint slugs that are enabled. When undefined, all checkpoints run. */
  enabledCheckpoints?: Set<string>;
};

export function runRiskEngine(
  transactions: NormalizedTransaction[],
  workflows: string[],
  options: RiskEngineOptions = {},
): RiskReport {
  const { thresholds = {}, enabledCheckpoints } = options;
  const results = [];
  if (workflows.includes('kyc')) results.push(runKyc(transactions, enabledCheckpoints, thresholds.kyc));
  if (workflows.includes('sg')) results.push(runSg(transactions, thresholds.sg, enabledCheckpoints));
  return { workflows: results };
}
