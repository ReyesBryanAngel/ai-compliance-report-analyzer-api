import type { PrismaClient } from '../generated/prisma/client';
import { DEFAULT_INSTRUCTIONS } from '../agent-skills/prompt-builder';
import type { InstructionItem } from './types';

type InstructionRow = {
  id: string;
  version: number;
  title: string | null;
  content: string;
  isActive: boolean;
  organizationId: string | null;
  createdAt: Date;
  updatedAt: Date;
  workflow: { slug: string };
  createdBy: { id: string; name: string | null; email: string } | null;
};

function toItem(row: InstructionRow): InstructionItem {
  return {
    id: row.id,
    workflow: row.workflow.slug,
    scope: row.organizationId ? 'org' : 'global',
    version: row.version,
    title: row.title,
    content: row.content,
    isActive: row.isActive,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function requireWorkflow(prisma: PrismaClient, workflowSlug: string) {
  const wf = await prisma.workflow.findUnique({ where: { slug: workflowSlug } });
  if (!wf) {
    throw Object.assign(new Error(`Workflow '${workflowSlug}' not found`), { code: 'NOT_FOUND' });
  }
  return wf;
}

export async function getActiveInstruction(
  prisma: PrismaClient,
  workflowId: string,
  orgId: string | null,
): Promise<InstructionItem | null> {
  if (orgId) {
    const orgRow = await prisma.agentSkillInstruction.findFirst({
      where: { workflowId, organizationId: orgId, isActive: true },
      include: { workflow: true, createdBy: true },
    });
    if (orgRow) return toItem(orgRow as InstructionRow);
  }

  const globalRow = await prisma.agentSkillInstruction.findFirst({
    where: { workflowId, organizationId: null, isActive: true },
    include: { workflow: true, createdBy: true },
  });
  return globalRow ? toItem(globalRow as InstructionRow) : null;
}

export async function getActiveInstructionForWorkflowSlug(
  prisma: PrismaClient,
  workflowSlug: string,
  orgId: string | null,
): Promise<InstructionItem | null> {
  const wf = await prisma.workflow.findUnique({ where: { slug: workflowSlug } });
  if (!wf) return null;
  return getActiveInstruction(prisma, wf.id, orgId);
}

export async function resolveEffectiveInstruction(
  prisma: PrismaClient,
  workflowSlug: string,
  orgId: string | null,
): Promise<{ source: 'org' | 'global' | 'built-in'; content: string; item: InstructionItem | null }> {
  const wf = await prisma.workflow.findUnique({ where: { slug: workflowSlug } });
  if (!wf) {
    throw Object.assign(new Error(`Workflow '${workflowSlug}' not found`), { code: 'NOT_FOUND' });
  }

  const item = await getActiveInstruction(prisma, wf.id, orgId);
  if (item) {
    return { source: item.scope, content: item.content, item };
  }

  const builtIn = DEFAULT_INSTRUCTIONS[workflowSlug];
  return {
    source: 'built-in',
    content: builtIn ?? `Analyze transactions for the "${workflowSlug}" workflow and produce compliance risk findings.`,
    item: null,
  };
}

export async function listInstructionVersions(
  prisma: PrismaClient,
  workflowSlug: string,
  orgId: string | null,
): Promise<InstructionItem[]> {
  await requireWorkflow(prisma, workflowSlug);

  const orConditions: object[] = [{ organizationId: null }];
  if (orgId) orConditions.push({ organizationId: orgId });

  const rows = await prisma.agentSkillInstruction.findMany({
    where: {
      workflow: { slug: workflowSlug },
      OR: orConditions,
    },
    include: { workflow: true, createdBy: true },
    orderBy: [{ organizationId: 'asc' }, { version: 'desc' }],
  });

  return rows.map((r) => toItem(r as InstructionRow));
}

export async function createInstructionVersion(
  prisma: PrismaClient,
  workflowSlug: string,
  orgId: string,
  body: { title?: string; content: string },
  createdById: string,
): Promise<InstructionItem> {
  const wf = await requireWorkflow(prisma, workflowSlug);

  // Compute next version number for this org
  const latest = await prisma.agentSkillInstruction.findFirst({
    where: { workflowId: wf.id, organizationId: orgId },
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  const nextVersion = (latest?.version ?? 0) + 1;

  const row = await prisma.agentSkillInstruction.create({
    data: {
      workflowId: wf.id,
      organizationId: orgId,
      version: nextVersion,
      title: body.title ?? null,
      content: body.content,
      isActive: false,
      createdById,
    },
    include: { workflow: true, createdBy: true },
  });

  return toItem(row as InstructionRow);
}

export async function activateInstructionVersion(
  prisma: PrismaClient,
  instructionId: string,
  orgId: string,
): Promise<InstructionItem> {
  const target = await prisma.agentSkillInstruction.findFirst({
    where: { id: instructionId, organizationId: orgId },
    include: { workflow: true, createdBy: true },
  });

  if (!target) {
    throw Object.assign(
      new Error(`Instruction '${instructionId}' not found for this organization`),
      { code: 'NOT_FOUND' },
    );
  }

  const updated = await prisma.$transaction(async (tx) => {
    await tx.agentSkillInstruction.updateMany({
      where: { workflowId: target.workflowId, organizationId: orgId, isActive: true },
      data: { isActive: false },
    });
    return tx.agentSkillInstruction.update({
      where: { id: instructionId },
      data: { isActive: true },
      include: { workflow: true, createdBy: true },
    });
  });

  return toItem(updated as InstructionRow);
}

export async function deleteInstructionVersion(
  prisma: PrismaClient,
  instructionId: string,
  orgId: string,
): Promise<void> {
  const target = await prisma.agentSkillInstruction.findFirst({
    where: { id: instructionId, organizationId: orgId },
  });

  if (!target) {
    throw Object.assign(
      new Error(`Instruction '${instructionId}' not found for this organization`),
      { code: 'NOT_FOUND' },
    );
  }

  await prisma.agentSkillInstruction.delete({ where: { id: instructionId } });
}
