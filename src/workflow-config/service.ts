import type { PrismaClient } from '../generated/prisma/client';
import { SUPPORTED_WORKFLOWS } from '../risk-engine/workflows';
import type { WorkflowConfigItem } from './types';

function toApiMode(mode: string): 'checkpoints' | 'agent_skill' {
  return mode === 'AGENT_SKILL' ? 'agent_skill' : 'checkpoints';
}

function toDbMode(mode: 'checkpoints' | 'agent_skill'): 'CHECKPOINTS' | 'AGENT_SKILL' {
  return mode === 'agent_skill' ? 'AGENT_SKILL' : 'CHECKPOINTS';
}

export async function listWorkflowConfigs(
  prisma: PrismaClient,
  orgId: string | null,
): Promise<WorkflowConfigItem[]> {
  const workflows = await prisma.workflow.findMany({
    where: { slug: { in: [...SUPPORTED_WORKFLOWS] } },
    select: { slug: true },
    orderBy: { slug: 'asc' },
  });

  if (!orgId) {
    return workflows.map((wf) => ({
      workflow: wf.slug,
      mode: 'agent_skill',
      isDefault: true,
      updatedAt: null,
    }));
  }

  const configs = await prisma.orgWorkflowConfig.findMany({
    where: { organizationId: orgId, workflow: { slug: { in: [...SUPPORTED_WORKFLOWS] } } },
    include: { workflow: true },
  });
  const configBySlug = new Map(configs.map((c) => [c.workflow.slug, c]));

  return workflows.map((wf) => {
    const orgConfig = configBySlug.get(wf.slug) ?? null;
    return {
      workflow: wf.slug,
      mode: orgConfig ? toApiMode(orgConfig.mode) : 'agent_skill',
      isDefault: !orgConfig,
      updatedAt: orgConfig ? orgConfig.updatedAt.toISOString() : null,
    };
  });
}

export async function getWorkflowMode(
  prisma: PrismaClient,
  orgId: string | null,
  workflowSlug: string,
): Promise<'CHECKPOINTS' | 'AGENT_SKILL'> {
  if (!orgId) return 'AGENT_SKILL';

  const config = await prisma.orgWorkflowConfig.findFirst({
    where: { organizationId: orgId, workflow: { slug: workflowSlug } },
  });
  return config ? (config.mode as 'CHECKPOINTS' | 'AGENT_SKILL') : 'AGENT_SKILL';
}

export async function setWorkflowMode(
  prisma: PrismaClient,
  orgId: string,
  workflowSlug: string,
  mode: 'checkpoints' | 'agent_skill',
): Promise<WorkflowConfigItem> {
  const workflow = await prisma.workflow.findUnique({ where: { slug: workflowSlug } });
  if (!workflow) {
    throw Object.assign(new Error(`Workflow '${workflowSlug}' not found`), { code: 'NOT_FOUND' });
  }

  const dbMode = toDbMode(mode);
  const config = await prisma.orgWorkflowConfig.upsert({
    where: { organizationId_workflowId: { organizationId: orgId, workflowId: workflow.id } },
    update: { mode: dbMode },
    create: { organizationId: orgId, workflowId: workflow.id, mode: dbMode },
  });

  return {
    workflow: workflowSlug,
    mode: toApiMode(config.mode),
    isDefault: false,
    updatedAt: config.updatedAt.toISOString(),
  };
}

export async function resetWorkflowMode(
  prisma: PrismaClient,
  orgId: string,
  workflowSlug: string,
): Promise<WorkflowConfigItem> {
  const workflow = await prisma.workflow.findUnique({ where: { slug: workflowSlug } });
  if (!workflow) {
    throw Object.assign(new Error(`Workflow '${workflowSlug}' not found`), { code: 'NOT_FOUND' });
  }

  await prisma.orgWorkflowConfig.deleteMany({
    where: { organizationId: orgId, workflowId: workflow.id },
  });

  return {
    workflow: workflowSlug,
    mode: 'agent_skill',
    isDefault: true,
    updatedAt: null,
  };
}
