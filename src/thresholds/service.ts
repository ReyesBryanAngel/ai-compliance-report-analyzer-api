import type { PrismaClient } from '../generated/prisma/client';
import { SG_DEFAULT_THRESHOLDS } from '../risk-engine/workflows/sg';
import type { SgThresholds } from '../risk-engine/workflows/sg';
import type { ThresholdConfigItem } from './types';

const WORKFLOW_DEFAULTS: Record<string, Record<string, { greenMax: number; amberMax: number }>> = {
  sg: SG_DEFAULT_THRESHOLDS,
};

type CheckpointWithWorkflow = {
  id: string;
  slug: string;
  workflowId: string;
  workflow: { slug: string };
  thresholdConfig: { id: string; greenMax: number; amberMax: number; updatedAt: Date } | null;
};

function toItem(cp: CheckpointWithWorkflow): ThresholdConfigItem {
  const defaults = WORKFLOW_DEFAULTS[cp.workflow.slug]?.[cp.slug] ?? { greenMax: 1, amberMax: 2 };
  if (cp.thresholdConfig) {
    return {
      id: cp.thresholdConfig.id,
      workflow: cp.workflow.slug,
      checkpoint: cp.slug,
      checkpointId: cp.id,
      greenMax: cp.thresholdConfig.greenMax,
      amberMax: cp.thresholdConfig.amberMax,
      updatedAt: cp.thresholdConfig.updatedAt.toISOString(),
      isDefault: false,
    };
  }
  return {
    id: '',
    workflow: cp.workflow.slug,
    checkpoint: cp.slug,
    checkpointId: cp.id,
    greenMax: defaults.greenMax,
    amberMax: defaults.amberMax,
    updatedAt: '',
    isDefault: true,
  };
}

export async function listAllThresholds(prisma: PrismaClient): Promise<ThresholdConfigItem[]> {
  const checkpoints = await prisma.checkpoint.findMany({
    include: { workflow: true, thresholdConfig: true },
    orderBy: [{ workflow: { slug: 'asc' } }, { slug: 'asc' }],
  });
  return checkpoints.map(toItem);
}

export async function listWorkflowThresholds(
  workflowSlug: string,
  prisma: PrismaClient,
): Promise<ThresholdConfigItem[]> {
  const checkpoints = await prisma.checkpoint.findMany({
    where: { workflow: { slug: workflowSlug } },
    include: { workflow: true, thresholdConfig: true },
    orderBy: { slug: 'asc' },
  });
  return checkpoints.map(toItem);
}

export async function upsertThreshold(
  workflowSlug: string,
  checkpointSlug: string,
  greenMax: number,
  amberMax: number,
  prisma: PrismaClient,
): Promise<ThresholdConfigItem> {
  if (greenMax < 0 || amberMax < 0) {
    throw Object.assign(new Error('greenMax and amberMax must be non-negative integers'), { code: 'VALIDATION' });
  }
  if (greenMax >= amberMax) {
    throw Object.assign(new Error('amberMax must be greater than greenMax'), { code: 'VALIDATION' });
  }

  const cp = await prisma.checkpoint.findFirst({
    where: { slug: checkpointSlug, workflow: { slug: workflowSlug } },
    include: { workflow: true },
  });

  if (!cp) {
    throw Object.assign(
      new Error(`Checkpoint '${checkpointSlug}' not found in workflow '${workflowSlug}'`),
      { code: 'NOT_FOUND' },
    );
  }

  const config = await prisma.thresholdConfig.upsert({
    where: { checkpointId: cp.id },
    update: { greenMax, amberMax },
    create: { checkpointId: cp.id, greenMax, amberMax },
  });

  return {
    id: config.id,
    workflow: workflowSlug,
    checkpoint: checkpointSlug,
    checkpointId: cp.id,
    greenMax: config.greenMax,
    amberMax: config.amberMax,
    updatedAt: config.updatedAt.toISOString(),
    isDefault: false,
  };
}

export async function resetThreshold(
  workflowSlug: string,
  checkpointSlug: string,
  prisma: PrismaClient,
): Promise<ThresholdConfigItem> {
  const cp = await prisma.checkpoint.findFirst({
    where: { slug: checkpointSlug, workflow: { slug: workflowSlug } },
    include: { workflow: true },
  });

  if (!cp) {
    throw Object.assign(
      new Error(`Checkpoint '${checkpointSlug}' not found in workflow '${workflowSlug}'`),
      { code: 'NOT_FOUND' },
    );
  }

  await prisma.thresholdConfig.deleteMany({ where: { checkpointId: cp.id } });

  const defaults = WORKFLOW_DEFAULTS[workflowSlug]?.[checkpointSlug] ?? { greenMax: 1, amberMax: 2 };
  return {
    id: '',
    workflow: workflowSlug,
    checkpoint: checkpointSlug,
    checkpointId: cp.id,
    greenMax: defaults.greenMax,
    amberMax: defaults.amberMax,
    updatedAt: '',
    isDefault: true,
  };
}

export async function loadSgThresholds(prisma: PrismaClient): Promise<Partial<SgThresholds>> {
  const configs = await prisma.thresholdConfig.findMany({
    where: { checkpoint: { workflow: { slug: 'sg' } } },
    include: { checkpoint: true },
  });
  const result: Partial<SgThresholds> = {};
  for (const config of configs) {
    const slug = config.checkpoint.slug as keyof SgThresholds;
    result[slug] = { greenMax: config.greenMax, amberMax: config.amberMax };
  }
  return result;
}
