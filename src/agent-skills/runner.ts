import type { PrismaClient } from '../generated/prisma/client';
import { computeOverallScore } from '../risk-engine/scoring';
import { generateAgentSkillFindings } from '../llm/agent-skill';
import { AgentSkillOutputSchema } from './schema';
import { AgentSkillExecutionError } from './errors';
import { buildAgentSkillPrompt, DEFAULT_INSTRUCTIONS } from './prompt-builder';
import type { AgentSkillContext } from './types';
import type { WorkflowResult, RiskFinding } from '../risk-engine/types';

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

async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  maxAttempts = 3,
  baseDelayMs = 500,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts) {
        const delay = baseDelayMs * Math.pow(2, attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}

export async function runAgentSkillWorkflow(
  ctx: AgentSkillContext,
  prisma: PrismaClient,
  log?: { warn: (msg: string, ...args: unknown[]) => void },
): Promise<WorkflowResult> {
  const { workflowSlug, organizationId, transactions, metadata } = ctx;

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

  let validatedOutput: { findings: Array<{ checkpoint: string; triggered: boolean; severity: 'low' | 'medium' | 'high'; score: number; reason: string; evidenceIndices: number[] }> };

  try {
    validatedOutput = await withRetry(async (attempt) => {
      const userPrompt = attempt > 1
        ? `${user}\n\n[Retry attempt ${attempt}: please ensure your JSON strictly matches the required schema]`
        : user;

      const result = await generateAgentSkillFindings(system, userPrompt);
      const parsed = AgentSkillOutputSchema.safeParse(result.data);

      if (!parsed.success) {
        log?.warn('[AgentSkill] Zod validation failed on attempt %d: %s', attempt, parsed.error.message);
        throw new AgentSkillExecutionError(
          `Model output failed validation: ${parsed.error.message}`,
        );
      }

      return parsed.data;
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new AgentSkillExecutionError(
      `Agent skill workflow '${workflowSlug}' failed after retries: ${message}`,
    );
  }

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

  return {
    workflow: workflowSlug,
    overallScore: computeOverallScore(findings),
    findings,
  };
}
