import type { PrismaClient } from '../generated/prisma/client';
import type {
  WorkflowExecutionSummary,
  AgentExecutionDetail,
  AgentMessageItem,
  ConversationDetail,
  ExecutionFilters,
  Page,
} from './types';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function encodeCursor(startedAt: Date, id: string): string {
  return Buffer.from(JSON.stringify({ startedAt: startedAt.toISOString(), id })).toString('base64');
}

function decodeCursor(token: string): { startedAt: Date; id: string } {
  const { startedAt, id } = JSON.parse(Buffer.from(token, 'base64').toString('utf8'));
  return { startedAt: new Date(startedAt), id };
}

function toExecutionSummary(row: {
  id: string;
  reportId: string;
  workflowSlug: string;
  mode: string;
  status: string;
  overallScore: number | null;
  error: string | null;
  startedAt: Date;
  completedAt: Date | null;
}): WorkflowExecutionSummary {
  return {
    id: row.id,
    reportId: row.reportId,
    workflowSlug: row.workflowSlug,
    mode: row.mode as WorkflowExecutionSummary['mode'],
    status: row.status as WorkflowExecutionSummary['status'],
    overallScore: row.overallScore,
    error: row.error,
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
  };
}

function toMessageItem(msg: {
  id: string;
  role: string;
  content: string;
  sequence: number;
  createdAt: Date;
}): AgentMessageItem {
  return {
    id: msg.id,
    role: msg.role as AgentMessageItem['role'],
    content: msg.content,
    sequence: msg.sequence,
    createdAt: msg.createdAt.toISOString(),
  };
}

function toExecutionDetail(row: {
  id: string;
  skillSlug: string;
  provider: string;
  model: string;
  sequence: number;
  status: string;
  promptTokens: number | null;
  completionTokens: number | null;
  latencyMs: number | null;
  error: string | null;
  startedAt: Date;
  completedAt: Date | null;
  messages: Array<{ id: string; role: string; content: string; sequence: number; createdAt: Date }>;
}): AgentExecutionDetail {
  return {
    id: row.id,
    skillSlug: row.skillSlug,
    provider: row.provider,
    model: row.model,
    sequence: row.sequence,
    status: row.status as AgentExecutionDetail['status'],
    promptTokens: row.promptTokens,
    completionTokens: row.completionTokens,
    latencyMs: row.latencyMs,
    error: row.error,
    messages: row.messages
      .sort((a, b) => a.sequence - b.sequence)
      .map(toMessageItem),
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
  };
}

export async function listWorkflowExecutions(
  prisma: PrismaClient,
  orgId: string | null,
  filters: ExecutionFilters,
): Promise<Page<WorkflowExecutionSummary>> {
  const limit = Math.min(filters.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const decoded = filters.cursor ? decodeCursor(filters.cursor) : null;

  const andConditions: object[] = [];

  if (decoded) {
    andConditions.push({
      OR: [
        { startedAt: { lt: decoded.startedAt } },
        { startedAt: { equals: decoded.startedAt }, id: { gt: decoded.id } },
      ],
    });
  }

  if (filters.from) andConditions.push({ startedAt: { gte: new Date(filters.from) } });
  if (filters.to) andConditions.push({ startedAt: { lte: new Date(filters.to) } });

  const items = await prisma.workflowExecution.findMany({
    where: {
      report: {
        ...(orgId ? { organizationId: orgId } : {}),
      },
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.workflowSlug ? { workflowSlug: filters.workflowSlug } : {}),
      ...(filters.mode ? { mode: filters.mode } : {}),
      ...(filters.reportId ? { reportId: filters.reportId } : {}),
      ...(andConditions.length > 0 ? { AND: andConditions } : {}),
    },
    orderBy: [{ startedAt: 'desc' }, { id: 'asc' }],
    take: limit + 1,
    select: {
      id: true,
      reportId: true,
      workflowSlug: true,
      mode: true,
      status: true,
      overallScore: true,
      error: true,
      startedAt: true,
      completedAt: true,
    },
  });

  const hasMore = items.length > limit;
  const page = hasMore ? items.slice(0, limit) : items;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? encodeCursor(last.startedAt, last.id) : null;

  return { items: page.map(toExecutionSummary), nextCursor };
}

export async function listReportExecutions(
  prisma: PrismaClient,
  orgId: string | null,
  reportId: string,
): Promise<WorkflowExecutionSummary[]> {
  const items = await prisma.workflowExecution.findMany({
    where: {
      reportId,
      report: {
        ...(orgId ? { organizationId: orgId } : {}),
      },
    },
    orderBy: [{ startedAt: 'asc' }],
    select: {
      id: true,
      reportId: true,
      workflowSlug: true,
      mode: true,
      status: true,
      overallScore: true,
      error: true,
      startedAt: true,
      completedAt: true,
    },
  });

  return items.map(toExecutionSummary);
}

export async function getWorkflowExecution(
  prisma: PrismaClient,
  orgId: string | null,
  id: string,
): Promise<WorkflowExecutionSummary> {
  const row = await prisma.workflowExecution.findFirst({
    where: {
      id,
      report: {
        ...(orgId ? { organizationId: orgId } : {}),
      },
    },
    select: {
      id: true,
      reportId: true,
      workflowSlug: true,
      mode: true,
      status: true,
      overallScore: true,
      error: true,
      startedAt: true,
      completedAt: true,
    },
  });

  if (!row) {
    throw Object.assign(new Error(`WorkflowExecution not found: ${id}`), { code: 'NOT_FOUND' });
  }

  return toExecutionSummary(row);
}

export async function getWorkflowExecutionConversation(
  prisma: PrismaClient,
  orgId: string | null,
  id: string,
): Promise<ConversationDetail> {
  const execution = await prisma.workflowExecution.findFirst({
    where: {
      id,
      report: {
        ...(orgId ? { organizationId: orgId } : {}),
      },
    },
    select: { id: true },
  });

  if (!execution) {
    throw Object.assign(new Error(`WorkflowExecution not found: ${id}`), { code: 'NOT_FOUND' });
  }

  const conversation = await prisma.agentConversation.findUnique({
    where: { workflowExecutionId: id },
    include: {
      executions: {
        orderBy: { sequence: 'asc' },
        include: {
          messages: {
            orderBy: { sequence: 'asc' },
          },
        },
      },
    },
  });

  if (!conversation) {
    throw Object.assign(
      new Error(`No conversation found for WorkflowExecution: ${id}`),
      { code: 'NOT_FOUND' },
    );
  }

  return {
    id: conversation.id,
    workflowExecutionId: conversation.workflowExecutionId,
    executions: conversation.executions.map(toExecutionDetail),
  };
}

export async function getAgentExecution(
  prisma: PrismaClient,
  orgId: string | null,
  id: string,
): Promise<AgentExecutionDetail> {
  const row = await prisma.agentExecution.findFirst({
    where: {
      id,
      conversation: {
        workflowExecution: {
          report: {
            ...(orgId ? { organizationId: orgId } : {}),
          },
        },
      },
    },
    include: {
      messages: {
        orderBy: { sequence: 'asc' },
      },
    },
  });

  if (!row) {
    throw Object.assign(new Error(`AgentExecution not found: ${id}`), { code: 'NOT_FOUND' });
  }

  return toExecutionDetail(row);
}
