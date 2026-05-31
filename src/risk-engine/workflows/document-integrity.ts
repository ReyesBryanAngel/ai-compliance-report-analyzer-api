import { NumericTransaction } from '../types';
import { WorkflowResult } from '../types';
import { computeOverallScore } from '../scoring';
import {
  checkStatementBalanceDiscrepancy,
  BALANCE_DISCREPANCY_DEFAULTS,
} from '../checkpoints/statement-balance-discrepancy';
import type { BalanceDiscrepancyParams } from '../checkpoints/statement-balance-discrepancy';
import { checkAmountDigitDistribution } from '../checkpoints/amount-digit-distribution';
import { checkClonedTransactionPattern } from '../checkpoints/cloned-transaction-pattern';
import { checkRoundAmountConcentration } from '../checkpoints/round-amount-concentration';

export type DocumentIntegrityThresholds = {
  'statement-balance-discrepancy': BalanceDiscrepancyParams;
};

export const DOCUMENT_INTEGRITY_DEFAULT_THRESHOLDS: DocumentIntegrityThresholds = {
  'statement-balance-discrepancy': BALANCE_DISCREPANCY_DEFAULTS,
};

export function runDocumentIntegrity(
  transactions: NumericTransaction[],
  thresholds: Partial<DocumentIntegrityThresholds> = {},
  enabledCheckpoints?: Set<string>,
): WorkflowResult {
  const resolved: DocumentIntegrityThresholds = {
    ...DOCUMENT_INTEGRITY_DEFAULT_THRESHOLDS,
    ...thresholds,
  };

  const enabled = (slug: string) => !enabledCheckpoints || enabledCheckpoints.has(slug);

  const findings = [
    ...(enabled('statement-balance-discrepancy')
      ? [checkStatementBalanceDiscrepancy(transactions, resolved['statement-balance-discrepancy'])]
      : []),
    ...(enabled('amount-digit-distribution')
      ? [checkAmountDigitDistribution(transactions)]
      : []),
    ...(enabled('cloned-transaction-pattern')
      ? [checkClonedTransactionPattern(transactions)]
      : []),
    ...(enabled('round-amount-concentration')
      ? [checkRoundAmountConcentration(transactions)]
      : []),
  ];

  return {
    workflow: 'document-integrity',
    overallScore: computeOverallScore(findings),
    findings,
  };
}
