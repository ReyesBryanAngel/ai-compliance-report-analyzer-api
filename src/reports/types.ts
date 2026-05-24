import type { WorkflowResult } from '../risk-engine/types';
import type { LLMNarrative } from '../llm/types';

export type { LLMNarrative };

export interface GenerateReportBody {
  workflows: string[];
  document_ids?: string[];
  batch_id?: string;
  title?: string;
}

export interface ReportSummary {
  severity: 'low' | 'medium' | 'high' | 'none';
  totalDocuments: number;
  totalTransactions: number;
  overallRiskScore: number;
  triggeredChecks: number;
  highRiskFindings: number;
}

export interface ReportCheckItem {
  id: string;
  rule: string;
  passed: boolean;
  details: string | null;
}

export interface GenerateReportResponse {
  id: string;
  title: string;
  status: string;
  documentIds: string[];
  workflows: string[];
  results: WorkflowResult[];
  checks: ReportCheckItem[];
  summary: ReportSummary;
  narrative: LLMNarrative | null;
  createdAt: string;
}

export interface GenerateReportBatchResponse {
  reports: GenerateReportResponse[];
}

export interface ListReportDocument {
  id: string;
  fileName: string;
}

export interface ListReportBatch {
  id: string;
  name: string;
}

export interface ListReportItem {
  id: string;
  title: string;
  status: string;
  documentIds: string[];
  documents: ListReportDocument[];
  batches: ListReportBatch[];
  workflows: string[];
  summary: ReportSummary | null;
  createdAt: string;
}
