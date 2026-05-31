import { NormalizedTransaction } from '../parser/types';

export type Severity = 'low' | 'medium' | 'high';

export type NumericTransaction = Omit<NormalizedTransaction, 'amount' | 'balance'> & {
  amount: number;
  balance?: number;
};

export type RiskFinding = {
  checkpoint: string;
  triggered: boolean;
  severity: Severity;
  score: number;
  reason: string;
  evidence: NumericTransaction[];
};

export type WorkflowResult = {
  workflow: string;
  overallScore: number;
  findings: RiskFinding[];
};

export type RiskReport = {
  workflows: WorkflowResult[];
};
