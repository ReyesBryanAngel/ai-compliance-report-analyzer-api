import { NormalizedTransaction } from '../../parser/types';
import { WorkflowResult } from '../types';
import { computeOverallScore } from '../scoring';
import { checkGamblingDebits } from '../checkpoints/gambling-debits';
import { checkGamblingDays } from '../checkpoints/gambling-days';
import { checkGamblingActivity } from '../checkpoints/gambling-activity';
import { checkGamblingOverdrafts } from '../checkpoints/gambling-overdrafts';
import { ThresholdBand } from '../checkpoints/gambling-utils';

export type SgThresholds = {
  'gambling-debits':    ThresholdBand;
  'gambling-days':      ThresholdBand;
  'gambling-activity':  ThresholdBand;
  'gambling-overdrafts': ThresholdBand;
};

export const SG_DEFAULT_THRESHOLDS: SgThresholds = {
  'gambling-debits':    { greenMax: 1, amberMax: 2 },
  'gambling-days':      { greenMax: 1, amberMax: 2 },
  'gambling-activity':  { greenMax: 1, amberMax: 2 },
  'gambling-overdrafts': { greenMax: 1, amberMax: 2 },
};

export function runSg(
  transactions: NormalizedTransaction[],
  thresholds: Partial<SgThresholds> = {},
  enabledCheckpoints?: Set<string>,
): WorkflowResult {
  const resolved: SgThresholds = {
    ...SG_DEFAULT_THRESHOLDS,
    ...thresholds,
  };

  const enabled = (slug: string) => !enabledCheckpoints || enabledCheckpoints.has(slug);
  const findings = [
    ...(enabled('gambling-debits') ? [checkGamblingDebits(transactions, resolved['gambling-debits'])] : []),
    ...(enabled('gambling-days') ? [checkGamblingDays(transactions, resolved['gambling-days'])] : []),
    ...(enabled('gambling-activity') ? [checkGamblingActivity(transactions, resolved['gambling-activity'])] : []),
    ...(enabled('gambling-overdrafts') ? [checkGamblingOverdrafts(transactions, resolved['gambling-overdrafts'])] : []),
  ];

  return {
    workflow: 'sg',
    overallScore: computeOverallScore(findings),
    findings,
  };
}
