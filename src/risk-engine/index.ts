import { NormalizedTransaction } from '../parser/types';
import { NumericTransaction } from './types';

export type { RiskFinding, RiskReport, WorkflowResult, NumericTransaction } from './types';

export const SUPPORTED_WORKFLOWS = ['kyc', 'sg', 'traml', 'document-integrity'] as const;
export type SupportedWorkflow = (typeof SUPPORTED_WORKFLOWS)[number];

export function normalizeTransactions(transactions: NormalizedTransaction[]): NumericTransaction[] {
  return transactions.map((tx) => ({
    ...tx,
    amount: parseFloat(tx.amount),
    balance: tx.balance !== undefined ? parseFloat(tx.balance) : undefined,
  }));
}
