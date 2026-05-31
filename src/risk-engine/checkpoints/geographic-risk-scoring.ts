import { NumericTransaction, RiskFinding } from '../types';

export type GeographicRiskThresholds = {
  minAmount: number;
  exposureGreenRatio: number;
  exposureAmberRatio: number;
  greenMax: number;
  amberMax: number;
};

export const GEO_RISK_DEFAULTS: GeographicRiskThresholds = {
  minAmount: 1_000,
  exposureGreenRatio: 0.05,
  exposureAmberRatio: 0.20,
  greenMax: 1,
  amberMax: 3,
};

export function checkGeographicRiskScoring(
  transactions: NumericTransaction[],
  _thresholds: GeographicRiskThresholds = GEO_RISK_DEFAULTS,
): RiskFinding {
  return {
    checkpoint: 'geographic-risk-scoring',
    triggered: false,
    severity: 'low',
    score: 10,
    reason: `Geographic risk scoring unavailable — no jurisdiction data present in transaction records (${transactions.length} transaction(s) reviewed).`,
    evidence: [],
  };
}
