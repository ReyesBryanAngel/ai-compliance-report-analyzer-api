import { NormalizedTransaction } from '../parser/types';
import { RiskReport } from './types';
import { runKyc, runSg, runTraml, runDocumentIntegrity } from './workflows';
import type { KycThresholds, SgThresholds, TramlThresholds, DocumentIntegrityThresholds } from './workflows';

export type { RiskFinding, RiskReport, WorkflowResult } from './types';
export { runKyc, runSg, runTraml, runDocumentIntegrity, SUPPORTED_WORKFLOWS } from './workflows';
export type { SupportedWorkflow, KycThresholds, SgThresholds, TramlThresholds, DocumentIntegrityThresholds } from './workflows';

export type RiskEngineThresholds = {
  kyc?: Partial<KycThresholds>;
  sg?: Partial<SgThresholds>;
  traml?: Partial<TramlThresholds>;
  documentIntegrity?: Partial<DocumentIntegrityThresholds>;
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
  if (workflows.includes('document-integrity')) results.push(runDocumentIntegrity(transactions, thresholds.documentIntegrity, enabledCheckpoints));
  return { workflows: results };
}
