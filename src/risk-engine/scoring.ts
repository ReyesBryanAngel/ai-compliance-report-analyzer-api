import { RiskFinding } from './types';

export function computeOverallScore(findings: RiskFinding[]): number {
  if (findings.length === 0) return 0;
  const scores = findings.map(f => f.score);
  const max = Math.max(...scores);
  const others = scores.filter(s => s !== max);
  const bump = others.reduce((a, b) => a + b, 0) * 0.1;
  return Math.min(100, Math.round(max + bump));
}
