import type { WorkflowResult } from '../risk-engine/types';

export interface GenerateReportBody {
  workflows: string[];
  document_ids?: string[];
  batch_id?: string;
  title?: string;
}

export interface ReportSummary {
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
  createdAt: string;
}

export interface ListReportItem {
  id: string;
  title: string;
  status: string;
  documentIds: string[];
  workflows: string[];
  summary: ReportSummary | null;
  createdAt: string;
}
