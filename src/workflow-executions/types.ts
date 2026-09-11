export interface WorkflowExecutionSummary {
  id: string;
  reportId: string;
  workflowSlug: string;
  mode: 'CHECKPOINTS' | 'AGENT_SKILL';
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  overallScore: number | null;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
}

export interface AgentMessageItem {
  id: string;
  role: 'SYSTEM' | 'USER' | 'ASSISTANT';
  content: string;
  sequence: number;
  createdAt: string;
}

export interface AgentExecutionDetail {
  id: string;
  skillSlug: string;
  provider: string;
  model: string;
  sequence: number;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  promptTokens: number | null;
  completionTokens: number | null;
  latencyMs: number | null;
  error: string | null;
  messages: AgentMessageItem[];
  startedAt: string;
  completedAt: string | null;
}

export interface ConversationDetail {
  id: string;
  workflowExecutionId: string;
  executions: AgentExecutionDetail[];
}

export interface ExecutionFilters {
  status?: 'RUNNING' | 'COMPLETED' | 'FAILED';
  workflowSlug?: string;
  mode?: 'CHECKPOINTS' | 'AGENT_SKILL';
  reportId?: string;
  from?: string;
  to?: string;
  cursor?: string;
  limit?: number;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
