export interface ConversationSummary {
  id: string;
  reportId: string;
  userId: string | null;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationMessageItem {
  id: string;
  conversationId: string;
  role: 'USER' | 'ASSISTANT';
  content: string;
  sequence: number;
  model: string | null;
  provider: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  latencyMs: number | null;
  createdAt: string;
}

export interface ConversationDetail {
  id: string;
  reportId: string;
  userId: string | null;
  createdAt: string;
  updatedAt: string;
  messages: ConversationMessageItem[];
}
