import type { PrismaClient } from '../generated/prisma/client';
import { runRiskEngine, SUPPORTED_WORKFLOWS } from '../risk-engine';
import type { NormalizedTransaction } from '../parser/types';
import type { WorkflowResult } from '../risk-engine/types';
import { generateNarrative } from '../llm/service';
import { loadKycThresholds, loadSgThresholds, loadTramlThresholds } from '../thresholds/service';
import type {
  GenerateReportBatchResponse,
  GenerateReportBody,
  GenerateReportResponse,
  ListReportBatch,
  ListReportDocument,
  ListReportItem,
  ReportCheckItem,
  ReportSummary,
} from './types';

function buildSummary(
  workflowResults: WorkflowResult[],
  totalDocuments: number,
  totalTransactions: number,
): ReportSummary {
  const allFindings = workflowResults.flatMap((w) => w.findings);
  const triggeredFindings = allFindings.filter((f) => f.triggered);
  const overallRiskScore =
    workflowResults.length > 0
      ? Math.max(...workflowResults.map((w) => w.overallScore))
      : 0;

  const severityRank: Record<string, number> = { none: -1, low: 0, medium: 1, high: 2 };
  const severity: ReportSummary['severity'] = triggeredFindings.reduce<ReportSummary['severity']>(
    (worst, f) => ((severityRank[f.severity] ?? -1) > severityRank[worst] ? f.severity as ReportSummary['severity'] : worst),
    'none',
  );

  return {
    severity,
    totalDocuments,
    totalTransactions,
    overallRiskScore,
    triggeredChecks: triggeredFindings.length,
    highRiskFindings: allFindings.filter((f) => f.severity === 'high').length,
  };
}

async function resolveEnabledCheckpoints(
  prisma: PrismaClient,
  workflows: string[],
  orgId: string | null,
): Promise<Set<string>> {
  if (orgId) {
    const checkpoints = await prisma.checkpoint.findMany({
      where: { workflow: { slug: { in: workflows } } },
      include: { orgOverrides: { where: { organizationId: orgId } } },
    });
    return new Set(
      checkpoints
        .filter((cp) => cp.orgOverrides.length > 0 ? cp.orgOverrides[0].enabled : cp.enabled)
        .map((cp) => cp.slug),
    );
  }

  const checkpoints = await prisma.checkpoint.findMany({
    where: { workflow: { slug: { in: workflows } }, enabled: true },
    select: { slug: true },
  });
  return new Set(checkpoints.map((cp) => cp.slug));
}

async function generateSingleReport(
  doc: { id: string; originalName: string; batchId: string | null },
  transactions: NormalizedTransaction[],
  workflows: string[],
  prisma: PrismaClient,
  userId: string,
  organizationId: string | null,
  enabledCheckpoints: Set<string>,
  thresholds: Record<string, unknown>,
  titleOverride?: string,
): Promise<GenerateReportResponse> {
  const dateStr = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const reportTitle = titleOverride
    ? `${titleOverride} — ${doc.originalName}`
    : `Compliance Report — ${doc.originalName} — ${dateStr}`;

  const report = await prisma.report.create({
    data: {
      title: reportTitle,
      status: 'GENERATING',
      documentIds: [doc.id],
      workflows,
      userId,
      ...(organizationId ? { organizationId } : {}),
    },
  });

  try {

    const riskReport = runRiskEngine(transactions, workflows, { thresholds, enabledCheckpoints });

    const savedChecks: ReportCheckItem[] = [];
    for (const wfResult of riskReport.workflows) {
      for (const finding of wfResult.findings) {
        const check = await prisma.complianceCheck.create({
          data: {
            reportId: report.id,
            rule: finding.checkpoint,
            passed: !finding.triggered,
            details: JSON.stringify({
              workflow: wfResult.workflow,
              severity: finding.severity,
              score: finding.score,
              reason: finding.reason,
              evidenceCount: finding.evidence.length,
            }),
          },
        });
        savedChecks.push({
          id: check.id,
          rule: check.rule,
          passed: check.passed,
          details: check.details,
        });
      }
    }

    const summary = buildSummary(riskReport.workflows, 1, transactions.length);
    const narrative = await generateNarrative(riskReport, summary);

    const documentNames: Record<string, string> = { [doc.id]: doc.originalName };

    let batches: ListReportBatch[] = [];
    if (doc.batchId) {
      const batchRecord = await prisma.documentBatch.findUnique({
        where: { id: doc.batchId },
        select: { id: true, name: true },
      });
      if (batchRecord) batches = [{ id: batchRecord.id, name: batchRecord.name }];
    }

    await prisma.report.update({
      where: { id: report.id },
      data: {
        content: JSON.stringify({ summary, riskReport, narrative, documentNames, batches }),
        status: 'COMPLETED',
      },
    });

    return {
      id: report.id,
      title: reportTitle,
      status: 'COMPLETED',
      documentIds: [doc.id],
      workflows,
      results: riskReport.workflows,
      checks: savedChecks,
      summary,
      narrative,
      createdAt: report.createdAt.toISOString(),
    };
  } catch (err) {
    await prisma.report.update({
      where: { id: report.id },
      data: { status: 'FAILED' },
    });
    throw err;
  }
}

export async function generateReport(
  body: GenerateReportBody,
  prisma: PrismaClient,
  userId: string,
  organizationId: string | null,
): Promise<GenerateReportBatchResponse> {
  const { workflows, document_ids, batch_id, title } = body;

  // Validate workflows
  const unsupported = workflows.filter(
    (w) => !(SUPPORTED_WORKFLOWS as readonly string[]).includes(w),
  );
  if (unsupported.length > 0) {
    throw Object.assign(
      new Error(`Unsupported workflows: ${unsupported.join(', ')}. Supported: ${SUPPORTED_WORKFLOWS.join(', ')}`),
      { code: 'UNSUPPORTED_WORKFLOW' },
    );
  }

  // Resolve document IDs from batch and/or explicit list
  let resolvedIds = document_ids ? [...document_ids] : [];

  if (batch_id) {
    const batchDocs = await prisma.document.findMany({
      where: {
        batchId: batch_id,
        ...(organizationId ? { organizationId } : {}),
      },
      select: { id: true },
    });

    if (batchDocs.length === 0) {
      throw Object.assign(
        new Error(`Batch not found or contains no documents: ${batch_id}`),
        { code: 'NOT_FOUND' },
      );
    }

    const merged = new Set([...resolvedIds, ...batchDocs.map((d) => d.id)]);
    resolvedIds = [...merged];
  }

  if (resolvedIds.length === 0) {
    throw Object.assign(
      new Error('Provide at least one of: document_ids or batch_id'),
      { code: 'VALIDATION' },
    );
  }

  // Fetch and validate documents — scope to org so cross-org IDs surface as NOT_FOUND
  const documents = await prisma.document.findMany({
    where: {
      id: { in: resolvedIds },
      ...(organizationId ? { organizationId } : {}),
    },
  });

  const foundIds = new Set(documents.map((d) => d.id));
  const missing = resolvedIds.filter((id) => !foundIds.has(id));
  if (missing.length > 0) {
    throw Object.assign(new Error(`Documents not found: ${missing.join(', ')}`), {
      code: 'NOT_FOUND',
    });
  }

  const notReady = documents.filter((d) => d.status !== 'COMPLETED');
  if (notReady.length > 0) {
    throw Object.assign(
      new Error(
        `Documents not ready for analysis (status must be COMPLETED): ${notReady.map((d) => `${d.id} [${d.status}]`).join(', ')}`,
      ),
      { code: 'NOT_READY' },
    );
  }

  const missingParsedData = documents.filter((d) => !d.parsedData);
  if (missingParsedData.length > 0) {
    throw Object.assign(
      new Error(
        `Documents have no parsed data: ${missingParsedData.map((d) => d.id).join(', ')}`,
      ),
      { code: 'NOT_READY' },
    );
  }

  // Resolve shared config once for all documents
  const enabledCheckpoints = await resolveEnabledCheckpoints(prisma, workflows, organizationId);
  const thresholds = {
    ...(workflows.includes('kyc') ? { kyc: await loadKycThresholds(prisma, organizationId) } : {}),
    ...(workflows.includes('sg') ? { sg: await loadSgThresholds(prisma, organizationId) } : {}),
    ...(workflows.includes('traml') ? { traml: await loadTramlThresholds(prisma, organizationId) } : {}),
  };

  const CONCURRENCY = 3;
  const results: GenerateReportResponse[] = new Array(documents.length);
  let idx = 0;
  async function worker() {
    while (idx < documents.length) {
      const i = idx++;
      const doc = documents[i];
      const transactions = doc.parsedData as NormalizedTransaction[];
      results[i] = await generateSingleReport(
        doc,
        transactions,
        workflows,
        prisma,
        userId,
        organizationId,
        enabledCheckpoints,
        thresholds,
        title,
      );
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, documents.length) }, worker));

  return { reports: results };
}

export async function getReport(
  reportId: string,
  prisma: PrismaClient,
  organizationId: string | null,
): Promise<GenerateReportResponse> {
  const where = organizationId
    ? { id: reportId, organizationId }
    : { id: reportId };

  const report = await prisma.report.findFirst({
    where,
    include: { checks: true },
  });

  if (!report) throw Object.assign(new Error('Report not found'), { code: 'NOT_FOUND' });

  const parsed = report.content ? JSON.parse(report.content) : null;
  const riskReport: { workflows: WorkflowResult[] } = parsed?.riskReport ?? { workflows: [] };
  const summary: ReportSummary | null = parsed?.summary ?? null;

  return {
    id: report.id,
    title: report.title ?? '',
    status: report.status,
    documentIds: report.documentIds,
    workflows: report.workflows,
    results: riskReport.workflows,
    checks: report.checks.map((c) => ({
      id: c.id,
      rule: c.rule,
      passed: c.passed,
      details: c.details,
    })),
    summary: summary ?? buildSummary([], 0, 0),
    narrative: parsed?.narrative ?? null,
    createdAt: report.createdAt.toISOString(),
  };
}

export async function listReports(
  prisma: PrismaClient,
  organizationId: string | null,
  workflow?: string,
): Promise<ListReportItem[]> {
  const reports = await prisma.report.findMany({
    where: {
      ...(organizationId ? { organizationId } : {}),
      ...(workflow ? { workflows: { has: workflow } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      title: true,
      status: true,
      documentIds: true,
      workflows: true,
      content: true,
      createdAt: true,
    },
  });

  const parsedContents = reports.map((r) => (r.content ? JSON.parse(r.content) : null));

  // Collect document IDs not covered by stored documentNames (old reports pre-dating this field)
  const uncoveredDocIds = new Set<string>();
  reports.forEach((r, i) => {
    const stored: Record<string, string> | undefined = parsedContents[i]?.documentNames;
    r.documentIds.forEach((id) => {
      if (!stored?.[id]) uncoveredDocIds.add(id);
    });
  });

  const fallbackDocMap = new Map<string, string>();
  const fallbackBatchMap = new Map<string, ListReportBatch[]>();

  if (uncoveredDocIds.size > 0) {
    const docRecords = await prisma.document.findMany({
      where: { id: { in: [...uncoveredDocIds] } },
      select: { id: true, originalName: true, batchId: true },
    });
    docRecords.forEach((d) => fallbackDocMap.set(d.id, d.originalName));

    const fallbackBatchIds = [...new Set(docRecords.map((d) => d.batchId).filter(Boolean) as string[])];
    if (fallbackBatchIds.length > 0) {
      const batchRecords = await prisma.documentBatch.findMany({
        where: { id: { in: fallbackBatchIds } },
        select: { id: true, name: true },
      });
      const batchById = new Map(batchRecords.map((b) => [b.id, b]));

      // Group batches per report for the fallback path
      reports.forEach((r, i) => {
        if (parsedContents[i]?.batches) return; // already stored — skip
        const batchesForReport = new Map<string, ListReportBatch>();
        r.documentIds.forEach((docId) => {
          const doc = docRecords.find((d) => d.id === docId);
          if (doc?.batchId) {
            const b = batchById.get(doc.batchId);
            if (b && !batchesForReport.has(b.id)) batchesForReport.set(b.id, b);
          }
        });
        fallbackBatchMap.set(r.id, [...batchesForReport.values()]);
      });
    }
  }

  const severityRank: Record<string, number> = { none: -1, low: 0, medium: 1, high: 2 };

  return reports.map((r, i) => {
    const parsed = parsedContents[i];
    const storedNames: Record<string, string> | undefined = parsed?.documentNames;
    const documents: ListReportDocument[] = r.documentIds.map((id) => ({
      id,
      fileName: storedNames?.[id] ?? fallbackDocMap.get(id) ?? id,
    }));
    const batches: ListReportBatch[] = parsed?.batches ?? fallbackBatchMap.get(r.id) ?? [];

    let summary: ReportSummary | null = parsed?.summary ?? null;
    if (summary && summary.severity === undefined) {
      const workflows: WorkflowResult[] = parsed?.riskReport?.workflows ?? [];
      const triggered = workflows.flatMap((w: WorkflowResult) => w.findings).filter((f: { triggered: boolean }) => f.triggered);
      const severity = triggered.reduce<ReportSummary['severity']>(
        (worst, f: { severity: string }) => ((severityRank[f.severity] ?? -1) > severityRank[worst] ? f.severity as ReportSummary['severity'] : worst),
        'none',
      );
      summary = { ...summary, severity };
    }

    return {
      id: r.id,
      title: r.title ?? '',
      status: r.status,
      documentIds: r.documentIds,
      documents,
      batches,
      workflows: r.workflows,
      summary,
      createdAt: r.createdAt.toISOString(),
    };
  });
}
