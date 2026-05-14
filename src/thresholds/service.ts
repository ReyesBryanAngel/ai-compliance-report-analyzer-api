import type { PrismaClient } from '../generated/prisma/client';
import { Prisma } from '../generated/prisma/client';
import { KYC_DEFAULT_THRESHOLDS } from '../risk-engine/workflows/kyc';
import type { KycThresholds } from '../risk-engine/workflows/kyc';
import { SG_DEFAULT_THRESHOLDS } from '../risk-engine/workflows/sg';
import type { SgThresholds } from '../risk-engine/workflows/sg';
import { TRAML_THRESHOLD_BANDS } from '../risk-engine/workflows/traml';
import type { TramlThresholds } from '../risk-engine/workflows/traml';
import { DOCUMENT_INTEGRITY_DEFAULT_THRESHOLDS } from '../risk-engine/workflows/document-integrity';
import type { DocumentIntegrityThresholds } from '../risk-engine/workflows/document-integrity';
import {
  RAPID_INFLOW_OUTFLOW_DEFAULTS,
} from '../risk-engine/checkpoints/rapid-inflow-outflow';
import type { RapidInflowOutflowThresholds } from '../risk-engine/checkpoints/rapid-inflow-outflow';
import {
  RAPID_MOVEMENT_DEFAULTS,
} from '../risk-engine/checkpoints/rapid-movement-of-funds';
import type { RapidMovementThresholds } from '../risk-engine/checkpoints/rapid-movement-of-funds';
import {
  CIRCULAR_TRANSACTION_DEFAULTS,
} from '../risk-engine/checkpoints/circular-transaction';
import type { CircularTransactionThresholds } from '../risk-engine/checkpoints/circular-transaction';
import {
  FRAGMENTED_TRANSACTION_DEFAULTS,
} from '../risk-engine/checkpoints/fragmented-transactions';
import type { FragmentedTransactionThresholds } from '../risk-engine/checkpoints/fragmented-transactions';
import {
  CTR_DEFAULTS,
} from '../risk-engine/checkpoints/ctr-threshold';
import type { CtrThresholds } from '../risk-engine/checkpoints/ctr-threshold';
import {
  CROSS_BORDER_DEFAULTS,
} from '../risk-engine/checkpoints/cross-border-transfer';
import type { CrossBorderThresholds } from '../risk-engine/checkpoints/cross-border-transfer';
import {
  GEO_RISK_DEFAULTS,
} from '../risk-engine/checkpoints/geographic-risk-scoring';
import type { GeographicRiskThresholds } from '../risk-engine/checkpoints/geographic-risk-scoring';
import type { ThresholdConfigItem } from './types';

const WORKFLOW_DEFAULTS: Record<string, Record<string, { greenMax: number; amberMax: number }>> = {
  kyc: KYC_DEFAULT_THRESHOLDS,
  sg: SG_DEFAULT_THRESHOLDS,
  traml: TRAML_THRESHOLD_BANDS,
  'document-integrity': DOCUMENT_INTEGRITY_DEFAULT_THRESHOLDS,
};

type CheckpointRow = {
  id: string;
  slug: string;
  workflowId: string;
  workflow: { slug: string };
  orgThresholdConfigs: { id: string; greenMax: number; amberMax: number; params: unknown; updatedAt: Date }[];
};

function toItem(cp: CheckpointRow, orgId: string | null): ThresholdConfigItem {
  const codeDefaults = WORKFLOW_DEFAULTS[cp.workflow.slug]?.[cp.slug] ?? { greenMax: 1, amberMax: 2 };
  const orgConfig = orgId ? cp.orgThresholdConfigs[0] ?? null : null;

  if (orgConfig) {
    return {
      id: orgConfig.id,
      workflow: cp.workflow.slug,
      checkpoint: cp.slug,
      checkpointId: cp.id,
      greenMax: orgConfig.greenMax,
      amberMax: orgConfig.amberMax,
      params: (orgConfig.params ?? null) as Record<string, unknown> | null,
      updatedAt: orgConfig.updatedAt.toISOString(),
      isDefault: false,
    };
  }

  return {
    id: '',
    workflow: cp.workflow.slug,
    checkpoint: cp.slug,
    checkpointId: cp.id,
    greenMax: codeDefaults.greenMax,
    amberMax: codeDefaults.amberMax,
    params: null,
    updatedAt: '',
    isDefault: true,
  };
}

async function fetchCheckpoints(
  prisma: PrismaClient,
  orgId: string | null,
  where: object,
  orderBy: object,
): Promise<CheckpointRow[]> {
  return prisma.checkpoint.findMany({
    where,
    include: {
      workflow: true,
      orgThresholdConfigs: orgId ? { where: { organizationId: orgId } } : false,
    },
    orderBy,
  }) as Promise<CheckpointRow[]>;
}

export async function listAllThresholds(
  prisma: PrismaClient,
  orgId: string | null,
): Promise<ThresholdConfigItem[]> {
  const checkpoints = await fetchCheckpoints(
    prisma,
    orgId,
    {},
    [{ workflow: { slug: 'asc' } }, { slug: 'asc' }],
  );
  return checkpoints.map((cp) => toItem(cp, orgId));
}

export async function listWorkflowThresholds(
  workflowSlug: string,
  prisma: PrismaClient,
  orgId: string | null,
): Promise<ThresholdConfigItem[]> {
  const checkpoints = await fetchCheckpoints(
    prisma,
    orgId,
    { workflow: { slug: workflowSlug } },
    { slug: 'asc' },
  );
  return checkpoints.map((cp) => toItem(cp, orgId));
}

export async function upsertThreshold(
  workflowSlug: string,
  checkpointSlug: string,
  greenMax: number,
  amberMax: number,
  prisma: PrismaClient,
  orgId: string,
  params?: Record<string, unknown>,
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

  const config = await prisma.orgThresholdConfig.upsert({
    where: { organizationId_checkpointId: { organizationId: orgId, checkpointId: cp.id } },
    update: { greenMax, amberMax, params: params ? (params as Prisma.InputJsonValue) : Prisma.DbNull },
    create: { organizationId: orgId, checkpointId: cp.id, greenMax, amberMax, params: params ? (params as Prisma.InputJsonValue) : Prisma.DbNull },
  });

  return {
    id: config.id,
    workflow: workflowSlug,
    checkpoint: checkpointSlug,
    checkpointId: cp.id,
    greenMax: config.greenMax,
    amberMax: config.amberMax,
    params: (config.params ?? null) as Record<string, unknown> | null,
    updatedAt: config.updatedAt.toISOString(),
    isDefault: false,
  };
}

export async function resetThreshold(
  workflowSlug: string,
  checkpointSlug: string,
  prisma: PrismaClient,
  orgId: string,
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

  await prisma.orgThresholdConfig.deleteMany({
    where: { organizationId: orgId, checkpointId: cp.id },
  });

  const defaults = WORKFLOW_DEFAULTS[workflowSlug]?.[checkpointSlug] ?? { greenMax: 1, amberMax: 2 };
  return {
    id: '',
    workflow: workflowSlug,
    checkpoint: checkpointSlug,
    checkpointId: cp.id,
    greenMax: defaults.greenMax,
    amberMax: defaults.amberMax,
    params: null,
    updatedAt: '',
    isDefault: true,
  };
}

// --- Threshold loaders called by the risk engine (org-aware) ---

export async function loadKycThresholds(
  prisma: PrismaClient,
  orgId: string | null,
): Promise<Partial<KycThresholds>> {
  if (!orgId) return {};

  const configs = await prisma.orgThresholdConfig.findMany({
    where: { organizationId: orgId, checkpoint: { workflow: { slug: 'kyc' } } },
    include: { checkpoint: true },
  });

  const result: Partial<KycThresholds> = {};
  for (const c of configs) {
    const slug = c.checkpoint.slug as keyof KycThresholds;
    result[slug] = { greenMax: c.greenMax, amberMax: c.amberMax };
  }
  return result;
}

export async function loadSgThresholds(
  prisma: PrismaClient,
  orgId: string | null,
): Promise<Partial<SgThresholds>> {
  if (!orgId) return {};

  const configs = await prisma.orgThresholdConfig.findMany({
    where: { organizationId: orgId, checkpoint: { workflow: { slug: 'sg' } } },
    include: { checkpoint: true },
  });

  const result: Partial<SgThresholds> = {};
  for (const c of configs) {
    const slug = c.checkpoint.slug as keyof SgThresholds;
    result[slug] = { greenMax: c.greenMax, amberMax: c.amberMax };
  }
  return result;
}

export async function loadDocumentIntegrityThresholds(
  prisma: PrismaClient,
  orgId: string | null,
): Promise<Partial<DocumentIntegrityThresholds>> {
  if (!orgId) return {};

  const configs = await prisma.orgThresholdConfig.findMany({
    where: { organizationId: orgId, checkpoint: { workflow: { slug: 'document-integrity' } } },
    include: { checkpoint: true },
  });

  const result: Partial<DocumentIntegrityThresholds> = {};
  for (const c of configs) {
    const slug = c.checkpoint.slug as keyof DocumentIntegrityThresholds;
    result[slug] = { greenMax: c.greenMax, amberMax: c.amberMax };
  }
  return result;
}

export async function loadTramlThresholds(
  prisma: PrismaClient,
  orgId: string | null,
): Promise<Partial<TramlThresholds>> {
  if (!orgId) return {};

  const configs = await prisma.orgThresholdConfig.findMany({
    where: { organizationId: orgId, checkpoint: { workflow: { slug: 'traml' } } },
    include: { checkpoint: true },
  });

  const result: Partial<TramlThresholds> = {};
  for (const c of configs) {
    if (c.checkpoint.slug === 'rapid-inflow-outflow') {
      result['rapid-inflow-outflow'] = {
        ...RAPID_INFLOW_OUTFLOW_DEFAULTS,
        greenMax: c.greenMax,
        amberMax: c.amberMax,
        // params carries checkpoint-specific overrides (windowHours, drainRatio, minInflow)
        // that don't fit the greenMax/amberMax columns
        ...(c.params ? (c.params as Partial<RapidInflowOutflowThresholds>) : {}),
      };
    }
    if (c.checkpoint.slug === 'rapid-movement-of-funds') {
      result['rapid-movement-of-funds'] = {
        ...RAPID_MOVEMENT_DEFAULTS,
        greenMax: c.greenMax,
        amberMax: c.amberMax,
        // params carries checkpoint-specific overrides (windowHours, velocityThreshold)
        ...(c.params ? (c.params as Partial<RapidMovementThresholds>) : {}),
      };
    }
    if (c.checkpoint.slug === 'circular-transaction') {
      result['circular-transaction'] = {
        ...CIRCULAR_TRANSACTION_DEFAULTS,
        greenMax: c.greenMax,
        amberMax: c.amberMax,
        // params carries checkpoint-specific overrides (windowHours, amountTolerance, minAmount)
        ...(c.params ? (c.params as Partial<CircularTransactionThresholds>) : {}),
      };
    }
    if (c.checkpoint.slug === 'fragmented-transactions') {
      result['fragmented-transactions'] = {
        ...FRAGMENTED_TRANSACTION_DEFAULTS,
        greenMax: c.greenMax,
        amberMax: c.amberMax,
        // params carries checkpoint-specific overrides (windowDays, singleTxnCeiling, aggregateFloor, minFragments)
        ...(c.params ? (c.params as Partial<FragmentedTransactionThresholds>) : {}),
      };
    }
    if (c.checkpoint.slug === 'ctr-threshold') {
      result['ctr-threshold'] = {
        ...CTR_DEFAULTS,
        greenMax: c.greenMax,
        amberMax: c.amberMax,
        // params carries checkpoint-specific overrides (singleTxLimit, dailyAggregateLimit)
        ...(c.params ? (c.params as Partial<CtrThresholds>) : {}),
      };
    }
    if (c.checkpoint.slug === 'cross-border-transfer') {
      result['cross-border-transfer'] = {
        ...CROSS_BORDER_DEFAULTS,
        greenMax: c.greenMax,
        amberMax: c.amberMax,
        // params carries checkpoint-specific overrides (minAmount, currencyMixWindowDays, currencyMixMinDistinct)
        ...(c.params ? (c.params as Partial<CrossBorderThresholds>) : {}),
      };
    }
    if (c.checkpoint.slug === 'geographic-risk-scoring') {
      result['geographic-risk-scoring'] = {
        ...GEO_RISK_DEFAULTS,
        greenMax: c.greenMax,
        amberMax: c.amberMax,
        // params carries checkpoint-specific overrides (minAmount, exposureGreenRatio, exposureAmberRatio)
        ...(c.params ? (c.params as Partial<GeographicRiskThresholds>) : {}),
      };
    }
  }
  return result;
}
