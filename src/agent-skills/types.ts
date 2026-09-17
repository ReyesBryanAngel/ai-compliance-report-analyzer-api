import type { NumericTransaction } from '../risk-engine/types';

export interface AgentSkillContext {
  workflowSlug: string;
  organizationId: string | null;
  transactions: NumericTransaction[];
  reportId: string;
  metadata?: {
    documentName?: string;
    dateRange?: { from: string; to: string };
  };
}
