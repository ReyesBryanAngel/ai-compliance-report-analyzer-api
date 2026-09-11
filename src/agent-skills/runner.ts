import type { PrismaClient } from '../generated/prisma/client';
import { computeOverallScore } from '../risk-engine/scoring';
import { generateAgentSkillFindings } from '../llm/agent-skill';
import { AgentSkillOutputSchema } from './schema';
import { AgentSkillExecutionError } from './errors';
import { buildAgentSkillPrompt, DEFAULT_INSTRUCTIONS } from './prompt-builder';
import type { AgentSkillContext } from './types';
import type { WorkflowResult, RiskFinding } from '../risk-engine/types';

const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 500;

async function getActiveInstruction(
  prisma: PrismaClient,
  workflowId: string,
  orgId: string | null,
): Promise<string | null> {
  if (orgId) {
    const orgRow = await prisma.agentSkillInstruction.findFirst({
      where: { workflowId, organizationId: orgId, isActive: true },
    });
    if (orgRow) return orgRow.content;
  }

  const globalRow = await prisma.agentSkillInstruction.findFirst({
    where: { workflowId, organizationId: null, isActive: true },
  });
  return globalRow ? globalRow.content : null;
}

export async function runAgentSkillWorkflow(
  ctx: AgentSkillContext,
  prisma: PrismaClient,
  log?: { warn: (msg: string, ...args: unknown[]) => void },
): Promise<WorkflowResult> {
  const { workflowSlug, organizationId, transactions, reportId, metadata } = ctx;

  const workflow = await prisma.workflow.findUnique({ where: { slug: workflowSlug } });
  if (!workflow) {
    throw new AgentSkillExecutionError(`Workflow '${workflowSlug}' not found in database`);
  }

  const instructionContent =
    (await getActiveInstruction(prisma, workflow.id, organizationId)) ??
    DEFAULT_INSTRUCTIONS[workflowSlug] ??
    `Analyze the transactions for the "${workflowSlug}" workflow and produce compliance risk findings.`;

  const checkpointCatalog = await prisma.checkpoint.findMany({
    where: { workflow: { slug: workflowSlug } },
    select: { slug: true, name: true, description: true },
    orderBy: { slug: 'asc' },
  });

  const { system, user } = buildAgentSkillPrompt({
    workflowSlug,
    instructions: instructionContent,
    checkpointCatalog,
    transactions,
    metadata,
  });

  const model = process.env.ANTHROPIC_AGENT_SKILL_MODEL || 'claude-haiku-4-5-20251001';

  // Create audit trail records before any LLM calls
  const workflowExecution = await prisma.workflowExecution.create({
    data: { reportId, workflowSlug, mode: 'AGENT_SKILL', status: 'RUNNING' },
  });

  const agentConversation = await prisma.agentConversation.create({
    data: { workflowExecutionId: workflowExecution.id },
  });

  const agentExecution = await prisma.agentExecution.create({
    data: {
      conversationId: agentConversation.id,
      skillSlug: workflowSlug,
      provider: 'anthropic',
      model,
      sequence: 1,
      status: 'RUNNING',
    },
  });

  // Record initial system + user prompts
  await prisma.agentMessage.createMany({
    data: [
      { agentExecutionId: agentExecution.id, role: 'SYSTEM', content: system, sequence: 1 },
      { agentExecutionId: agentExecution.id, role: 'USER', content: user, sequence: 2 },
    ],
  });

  let messageSeq = 3;
  let lastError: unknown;
  let validatedOutput: {
    findings: Array<{
      checkpoint: string;
      triggered: boolean;
      severity: 'low' | 'medium' | 'high';
      score: number;
      reason: string;
      evidenceIndices: number[];
    }>;
  } | null = null;
  let finalUsage: { promptTokens: number; completionTokens: number } | null = null;
  const startMs = Date.now();

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const userPrompt =
      attempt > 1
        ? `${user}\n\n[Retry attempt ${attempt}: please ensure your JSON strictly matches the required schema]`
        : user;

    // Record the retry user message before the LLM call (attempts 2+)
    if (attempt > 1) {
      await prisma.agentMessage.create({
        data: {
          agentExecutionId: agentExecution.id,
          role: 'USER',
          content: userPrompt,
          sequence: messageSeq++,
        },
      });
    }

    try {
      const result = await generateAgentSkillFindings(system, userPrompt);
      const parsed = AgentSkillOutputSchema.safeParse(result.data);

      if (!parsed.success) {
        log?.warn('[AgentSkill] Zod validation failed on attempt %d: %s', attempt, parsed.error.message);

        // Record the invalid assistant response
        await prisma.agentMessage.create({
          data: {
            agentExecutionId: agentExecution.id,
            role: 'ASSISTANT',
            content: result.raw,
            sequence: messageSeq++,
          },
        });

        if (attempt < MAX_ATTEMPTS) {
          // Record the validation failure notice as a system message before retrying
          await prisma.agentMessage.create({
            data: {
              agentExecutionId: agentExecution.id,
              role: 'SYSTEM',
              content: `Validation failed on attempt ${attempt}: ${parsed.error.message}. Retrying.`,
              sequence: messageSeq++,
            },
          });
          await new Promise((resolve) => setTimeout(resolve, BASE_DELAY_MS * Math.pow(2, attempt - 1)));
        }

        lastError = new AgentSkillExecutionError(
          `Model output failed validation: ${parsed.error.message}`,
        );
        continue;
      }

      // Success — record the final assistant response
      finalUsage = result.usage;
      validatedOutput = parsed.data;
      await prisma.agentMessage.create({
        data: {
          agentExecutionId: agentExecution.id,
          role: 'ASSISTANT',
          content: result.raw,
          sequence: messageSeq++,
        },
      });
      break;
    } catch (err) {
      // API-level error (network, service unavailable, etc.) — no response to record
      lastError = err;
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, BASE_DELAY_MS * Math.pow(2, attempt - 1)));
      }
    }
  }

  const latencyMs = Date.now() - startMs;

  if (!validatedOutput) {
    const errorMsg = lastError instanceof Error ? lastError.message : String(lastError);

    await prisma.agentExecution.update({
      where: { id: agentExecution.id },
      data: { status: 'FAILED', error: errorMsg, latencyMs, completedAt: new Date() },
    });

    await prisma.workflowExecution.update({
      where: { id: workflowExecution.id },
      data: { status: 'FAILED', error: errorMsg, completedAt: new Date() },
    });

    throw new AgentSkillExecutionError(
      `Agent skill workflow '${workflowSlug}' failed after retries: ${errorMsg}`,
    );
  }

  await prisma.agentExecution.update({
    where: { id: agentExecution.id },
    data: {
      status: 'COMPLETED',
      promptTokens: finalUsage?.promptTokens ?? null,
      completionTokens: finalUsage?.completionTokens ?? null,
      latencyMs,
      completedAt: new Date(),
    },
  });

  const findings: RiskFinding[] = validatedOutput.findings.map((f) => {
    const evidence = f.evidenceIndices
      .filter((i) => {
        const valid = i >= 0 && i < transactions.length;
        if (!valid) {
          log?.warn('[AgentSkill] evidenceIndex %d out of range (txCount=%d), dropping', i, transactions.length);
        }
        return valid;
      })
      .map((i) => transactions[i]);

    return {
      checkpoint: f.checkpoint,
      triggered: f.triggered,
      severity: f.severity,
      score: f.score,
      reason: f.reason,
      evidence,
    };
  });

  const overallScore = computeOverallScore(findings);

  await prisma.workflowExecution.update({
    where: { id: workflowExecution.id },
    data: { status: 'COMPLETED', overallScore, completedAt: new Date() },
  });

  return { workflow: workflowSlug, overallScore, findings };
}
