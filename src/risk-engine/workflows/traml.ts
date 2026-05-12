import { NormalizedTransaction } from '../../parser/types';
import { WorkflowResult } from '../types';
import { computeOverallScore } from '../scoring';
import {
  checkRapidInflowOutflow,
  RAPID_INFLOW_OUTFLOW_DEFAULTS,
} from '../checkpoints/rapid-inflow-outflow';
import type { RapidInflowOutflowThresholds } from '../checkpoints/rapid-inflow-outflow';

export type TramlThresholds = {
  'rapid-inflow-outflow': RapidInflowOutflowThresholds;
};

export const TRAML_DEFAULT_THRESHOLDS: TramlThresholds = {
  'rapid-inflow-outflow': RAPID_INFLOW_OUTFLOW_DEFAULTS,
};

/** Subset of TRAML_DEFAULT_THRESHOLDS shaped for the shared WORKFLOW_DEFAULTS map in thresholds/service.ts. */
export const TRAML_THRESHOLD_BANDS: Record<keyof TramlThresholds, { greenMax: number; amberMax: number }> = {
  'rapid-inflow-outflow': {
    greenMax: RAPID_INFLOW_OUTFLOW_DEFAULTS.greenMax,
    amberMax: RAPID_INFLOW_OUTFLOW_DEFAULTS.amberMax,
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
  ];

  return {
    workflow: 'traml',
    overallScore: computeOverallScore(findings),
    findings,
  };
}
