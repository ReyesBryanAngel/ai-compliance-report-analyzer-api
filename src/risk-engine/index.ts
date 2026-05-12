import { NormalizedTransaction } from '../parser/types';
import { RiskReport } from './types';
import { runKyc, runSg, runTraml } from './workflows';
import type { KycThresholds, SgThresholds, TramlThresholds } from './workflows';

export type { RiskFinding, RiskReport, WorkflowResult } from './types';
export { runKyc, runSg, runTraml, SUPPORTED_WORKFLOWS } from './workflows';
export type { SupportedWorkflow, KycThresholds, SgThresholds, TramlThresholds } from './workflows';

export type RiskEngineThresholds = {
  kyc?: Partial<KycThresholds>;
  sg?: Partial<SgThresholds>;
  traml?: Partial<TramlThresholds>;
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
  if (workflows.includes('traml')) results.push(runTraml(transactions, thresholds.traml, enabledCheckpoints));
  return { workflows: results };
}
