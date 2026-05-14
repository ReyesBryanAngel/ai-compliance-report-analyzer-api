import { NormalizedTransaction } from '../../parser/types';
import { WorkflowResult } from '../types';
import { computeOverallScore } from '../scoring';
import {
  checkRapidInflowOutflow,
  RAPID_INFLOW_OUTFLOW_DEFAULTS,
} from '../checkpoints/rapid-inflow-outflow';
import type { RapidInflowOutflowThresholds } from '../checkpoints/rapid-inflow-outflow';
import {
  checkRapidMovementOfFunds,
  RAPID_MOVEMENT_DEFAULTS,
} from '../checkpoints/rapid-movement-of-funds';
import type { RapidMovementThresholds } from '../checkpoints/rapid-movement-of-funds';
import {
  checkCircularTransaction,
  CIRCULAR_TRANSACTION_DEFAULTS,
} from '../checkpoints/circular-transaction';
import type { CircularTransactionThresholds } from '../checkpoints/circular-transaction';
import {
  checkFragmentedTransactions,
  FRAGMENTED_TRANSACTION_DEFAULTS,
} from '../checkpoints/fragmented-transactions';
import type { FragmentedTransactionThresholds } from '../checkpoints/fragmented-transactions';
import {
  checkCtrThreshold,
  CTR_DEFAULTS,
} from '../checkpoints/ctr-threshold';
import type { CtrThresholds } from '../checkpoints/ctr-threshold';
import {
  checkCrossBorderTransfer,
  CROSS_BORDER_DEFAULTS,
} from '../checkpoints/cross-border-transfer';
import type { CrossBorderThresholds } from '../checkpoints/cross-border-transfer';
import {
  checkGeographicRiskScoring,
  GEO_RISK_DEFAULTS,
} from '../checkpoints/geographic-risk-scoring';
import type { GeographicRiskThresholds } from '../checkpoints/geographic-risk-scoring';

export type TramlThresholds = {
  'rapid-inflow-outflow': RapidInflowOutflowThresholds;
  'rapid-movement-of-funds': RapidMovementThresholds;
  'circular-transaction': CircularTransactionThresholds;
  'fragmented-transactions': FragmentedTransactionThresholds;
  'ctr-threshold': CtrThresholds;
  'cross-border-transfer': CrossBorderThresholds;
  'geographic-risk-scoring': GeographicRiskThresholds;
};

export const TRAML_DEFAULT_THRESHOLDS: TramlThresholds = {
  'rapid-inflow-outflow': RAPID_INFLOW_OUTFLOW_DEFAULTS,
  'rapid-movement-of-funds': RAPID_MOVEMENT_DEFAULTS,
  'circular-transaction': CIRCULAR_TRANSACTION_DEFAULTS,
  'fragmented-transactions': FRAGMENTED_TRANSACTION_DEFAULTS,
  'ctr-threshold': CTR_DEFAULTS,
  'cross-border-transfer': CROSS_BORDER_DEFAULTS,
  'geographic-risk-scoring': GEO_RISK_DEFAULTS,
};

/** Subset of TRAML_DEFAULT_THRESHOLDS shaped for the shared WORKFLOW_DEFAULTS map in thresholds/service.ts. */
export const TRAML_THRESHOLD_BANDS: Record<keyof TramlThresholds, { greenMax: number; amberMax: number }> = {
  'rapid-inflow-outflow': {
    greenMax: RAPID_INFLOW_OUTFLOW_DEFAULTS.greenMax,
    amberMax: RAPID_INFLOW_OUTFLOW_DEFAULTS.amberMax,
  },
  'rapid-movement-of-funds': {
    greenMax: RAPID_MOVEMENT_DEFAULTS.greenMax,
    amberMax: RAPID_MOVEMENT_DEFAULTS.amberMax,
  },
  'circular-transaction': {
    greenMax: CIRCULAR_TRANSACTION_DEFAULTS.greenMax,
    amberMax: CIRCULAR_TRANSACTION_DEFAULTS.amberMax,
  },
  'fragmented-transactions': {
    greenMax: FRAGMENTED_TRANSACTION_DEFAULTS.greenMax,
    amberMax: FRAGMENTED_TRANSACTION_DEFAULTS.amberMax,
  },
  'ctr-threshold': {
    greenMax: CTR_DEFAULTS.greenMax,
    amberMax: CTR_DEFAULTS.amberMax,
  },
  'cross-border-transfer': {
    greenMax: CROSS_BORDER_DEFAULTS.greenMax,
    amberMax: CROSS_BORDER_DEFAULTS.amberMax,
  },
  'geographic-risk-scoring': {
    greenMax: GEO_RISK_DEFAULTS.greenMax,
    amberMax: GEO_RISK_DEFAULTS.amberMax,
  },
};

export function runTraml(
  transactions: NormalizedTransaction[],
  thresholds: Partial<TramlThresholds> = {},
  enabledCheckpoints?: Set<string>,
): WorkflowResult {
  const resolved: TramlThresholds = {
    ...TRAML_DEFAULT_THRESHOLDS,
    ...thresholds,
  };

  const enabled = (slug: string) => !enabledCheckpoints || enabledCheckpoints.has(slug);

  const findings = [
    ...(enabled('rapid-inflow-outflow')
      ? [checkRapidInflowOutflow(transactions, resolved['rapid-inflow-outflow'])]
      : []),
    ...(enabled('rapid-movement-of-funds')
      ? [checkRapidMovementOfFunds(transactions, resolved['rapid-movement-of-funds'])]
      : []),
    ...(enabled('circular-transaction')
      ? [checkCircularTransaction(transactions, resolved['circular-transaction'])]
      : []),
    ...(enabled('fragmented-transactions')
      ? [checkFragmentedTransactions(transactions, resolved['fragmented-transactions'])]
      : []),
    ...(enabled('ctr-threshold')
      ? [checkCtrThreshold(transactions, resolved['ctr-threshold'])]
      : []),
    ...(enabled('cross-border-transfer')
      ? [checkCrossBorderTransfer(transactions, resolved['cross-border-transfer'])]
      : []),
    ...(enabled('geographic-risk-scoring')
      ? [checkGeographicRiskScoring(transactions, resolved['geographic-risk-scoring'])]
      : []),
  ];

  return {
    workflow: 'traml',
    overallScore: computeOverallScore(findings),
    findings,
  };
}
