import type { PrismaClient } from '../generated/prisma/client';
import { buildReportContext } from './context-builder';
import { generateConversationResponse } from '../llm/report-conversation';
import type {
  ConversationSummary,
  ConversationDetail,
  ConversationMessageItem,
} from './types';

const MAX_HISTORY_TURNS = 10;

function toMessageItem(msg: {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  sequence: number;
  model: string | null;
  provider: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  latencyMs: number | null;
  createdAt: Date;
}): ConversationMessageItem {
  return {
    id: msg.id,
    conversationId: msg.conversationId,
    role: msg.role as ConversationMessageItem['role'],
    content: msg.content,
    sequence: msg.sequence,
    model: msg.model,
    provider: msg.provider,
    promptTokens: msg.promptTokens,
    completionTokens: msg.completionTokens,
    latencyMs: msg.latencyMs,
    createdAt: msg.createdAt.toISOString(),
  };
}

export async function createConversation(
  prisma: PrismaClient,
  reportId: string,
  userId: string,
  orgId: string | null,
): Promise<{ id: string; reportId: string; createdAt: string }> {
  const where = orgId ? { id: reportId, organizationId: orgId } : { id: reportId };
  const report = await prisma.report.findFirst({ where, select: { id: true, status: true } });

  if (!report) {
    throw Object.assign(new Error('Report not found'), { code: 'NOT_FOUND' });
  }

  if (report.status !== 'COMPLETED') {
    throw Object.assign(
      new Error('Report must be in COMPLETED status to start a conversation'),
      { code: 'REPORT_NOT_COMPLETED' },
    );
  }

  const conversation = await prisma.reportConversation.create({
    data: { reportId, userId },
  });

  return {
    id: conversation.id,
    reportId: conversation.reportId,
    createdAt: conversation.createdAt.toISOString(),
  };
}

export async function sendMessage(
  prisma: PrismaClient,
  reportId: string,
  conversationId: string,
  userMessage: string,
  userId: string,
  orgId: string | null,
): Promise<ConversationMessageItem> {
  if (!userMessage || userMessage.length < 1 || userMessage.length > 2000) {
    throw Object.assign(
      new Error('Message must be between 1 and 2000 characters'),
      { code: 'VALIDATION' },
    );
  }

  const conversation = await prisma.reportConversation.findFirst({
    where: {
      id: conversationId,
      reportId,
      report: orgId ? { organizationId: orgId } : undefined,
    },
    select: { id: true, reportId: true },
  });

  if (!conversation) {
    throw Object.assign(new Error('Conversation not found'), { code: 'NOT_FOUND' });
  }

  // Load last MAX_HISTORY_TURNS * 2 messages for LLM context
  const recentMessages = await prisma.reportConversationMessage.findMany({
    where: { conversationId },
    orderBy: { sequence: 'desc' },
    take: MAX_HISTORY_TURNS * 2,
    select: { role: true, content: true, sequence: true },
  });

  const history = recentMessages
    .reverse()
    .map((m) => ({
      role: m.role.toLowerCase() as 'user' | 'assistant',
      content: m.content,
    }));

  // Get the next sequence number
  const lastMessage = recentMessages[0]; // desc order — first is latest
  const nextSequence = lastMessage ? lastMessage.sequence + 1 : 1;

  // Build report context (system prompt) and call LLM
  const systemPrompt = await buildReportContext(conversation.reportId, prisma, orgId);

  let llmResponse: Awaited<ReturnType<typeof generateConversationResponse>>;
  try {
    llmResponse = await generateConversationResponse(systemPrompt, history, userMessage);
  } catch (err) {
    throw Object.assign(new Error('Failed to generate response'), { code: 'LLM_ERROR', cause: err });
  }

  // Persist USER and ASSISTANT messages in a single transaction
  const [, assistantMsg] = await prisma.$transaction([
    prisma.reportConversationMessage.create({
      data: {
        conversationId,
        role: 'USER',
        content: userMessage,
        sequence: nextSequence,
      },
    }),
    prisma.reportConversationMessage.create({
      data: {
        conversationId,
        role: 'ASSISTANT',
        content: llmResponse.content,
        sequence: nextSequence + 1,
        model: llmResponse.model,
        provider: llmResponse.provider,
        promptTokens: llmResponse.promptTokens,
        completionTokens: llmResponse.completionTokens,
        latencyMs: llmResponse.latencyMs,
      },
    }),
  ]);

  return toMessageItem(assistantMsg);
}

export async function getConversation(
  prisma: PrismaClient,
  reportId: string,
  conversationId: string,
  orgId: string | null,
): Promise<ConversationDetail> {
  const conversation = await prisma.reportConversation.findFirst({
    where: {
      id: conversationId,
      reportId,
      report: orgId ? { organizationId: orgId } : undefined,
    },
    include: {
      messages: { orderBy: { sequence: 'asc' } },
    },
  });

  if (!conversation) {
    throw Object.assign(new Error('Conversation not found'), { code: 'NOT_FOUND' });
  }

  return {
    id: conversation.id,
    reportId: conversation.reportId,
    userId: conversation.userId,
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString(),
    messages: conversation.messages.map(toMessageItem),
  };
}

export async function listConversations(
  prisma: PrismaClient,
  reportId: string,
  orgId: string | null,
): Promise<ConversationSummary[]> {
  // Verify the report is visible to this org before listing
  const reportWhere = orgId ? { id: reportId, organizationId: orgId } : { id: reportId };
  const report = await prisma.report.findFirst({ where: reportWhere, select: { id: true } });

  if (!report) {
    throw Object.assign(new Error('Report not found'), { code: 'NOT_FOUND' });
  }

  const conversations = await prisma.reportConversation.findMany({
    where: { reportId },
    orderBy: { createdAt: 'desc' },
    include: {
      _count: { select: { messages: true } },
    },
  });

  return conversations.map((c) => ({
    id: c.id,
    reportId: c.reportId,
    userId: c.userId,
    messageCount: c._count.messages,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  }));
}
