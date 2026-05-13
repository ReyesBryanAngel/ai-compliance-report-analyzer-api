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

export type TramlThresholds = {
  'rapid-inflow-outflow': RapidInflowOutflowThresholds;
  'rapid-movement-of-funds': RapidMovementThresholds;
  'circular-transaction': CircularTransactionThresholds;
};

export const TRAML_DEFAULT_THRESHOLDS: TramlThresholds = {
  'rapid-inflow-outflow': RAPID_INFLOW_OUTFLOW_DEFAULTS,
  'rapid-movement-of-funds': RAPID_MOVEMENT_DEFAULTS,
  'circular-transaction': CIRCULAR_TRANSACTION_DEFAULTS,
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
  ];

  return {
    workflow: 'traml',
    overallScore: computeOverallScore(findings),
    findings,
  };
}
