import { NormalizedTransaction } from '../parser/types';
import { RiskReport, NumericTransaction } from './types';
import { runKyc, runSg, runTraml, runDocumentIntegrity } from './workflows';
import type { KycThresholds, SgThresholds, TramlThresholds, DocumentIntegrityThresholds } from './workflows';

export type { RiskFinding, RiskReport, WorkflowResult, NumericTransaction } from './types';
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

function normalizeAmounts(transactions: NormalizedTransaction[]): NumericTransaction[] {
  return transactions.map((tx) => ({
    ...tx,
    amount: parseFloat(tx.amount),
    balance: tx.balance !== undefined ? parseFloat(tx.balance) : undefined,
  }));
}

export function runRiskEngine(
  transactions: NormalizedTransaction[],
  workflows: string[],
  options: RiskEngineOptions = {},
): RiskReport {
  const { thresholds = {}, enabledCheckpoints } = options;
  const txs = normalizeAmounts(transactions);
  const results = [];
  if (workflows.includes('kyc')) results.push(runKyc(txs, enabledCheckpoints, thresholds.kyc));
  if (workflows.includes('sg')) results.push(runSg(txs, thresholds.sg, enabledCheckpoints));
  if (workflows.includes('traml')) results.push(runTraml(txs, thresholds.traml, enabledCheckpoints));
  if (workflows.includes('document-integrity')) results.push(runDocumentIntegrity(txs, thresholds.documentIntegrity, enabledCheckpoints));
  return { workflows: results };
}
