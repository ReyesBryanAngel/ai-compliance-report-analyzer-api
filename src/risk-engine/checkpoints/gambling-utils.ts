import { NormalizedTransaction } from '../../parser/types';

const GAMBLING_PATTERNS = [
  /\bcasino\b/i,
  /\bbet(ting)?\b/i,
  /\bgambl(e|ing|er|ers)?\b/i,
  /\blott(o|ery)\b/i,
  /\bpoker\b/i,
  /\bslots?\b/i,
  /\bbingo\b/i,
  /\bsportsbet\b/i,
  /\bsports[\s-]?bet\b/i,
  /\bpagcor\b/i,
  /\be-?games?\b/i,
  /\bsabong\b/i,
  /\bcockpit\b/i,
  /\bjai[\s-]?alai\b/i,
  /\bhorse[\s-]?rac(e|ing)\b/i,
  /\bphilippine[\s-]?amusement\b/i,
  /\bpcea\b/i,
  /\bsportsbetting\b/i,
];

export function isGamblingTx(tx: NormalizedTransaction): boolean {
  if (tx.category === 'gambling') return true;
  return GAMBLING_PATTERNS.some((p) => p.test(tx.description));
}

export type ThresholdBand = { greenMax: number; amberMax: number };

export function applyThreshold(
  count: number,
  band: ThresholdBand,
  checkpointName: string,
  metricLabel: string,
  evidence: NormalizedTransaction[],
) {
  const { greenMax, amberMax } = band;

  if (count <= greenMax) {
    return {
      checkpoint: checkpointName,
      triggered: false,
      severity: 'low' as const,
      score: 10,
      reason: `${metricLabel}: ${count} (within safe limit of ≤${greenMax})`,
      evidence,
    };
  }

  if (count <= amberMax) {
    return {
      checkpoint: checkpointName,
      triggered: true,
      severity: 'medium' as const,
      score: 60,
      reason: `${metricLabel}: ${count} (amber threshold — limit is ≤${greenMax} safe, ≤${amberMax} amber)`,
      evidence,
    };
  }

  return {
    checkpoint: checkpointName,
    triggered: true,
    severity: 'high' as const,
    score: 90,
    reason: `${metricLabel}: ${count} (exceeds red threshold of >${amberMax})`,
    evidence,
  };
}
