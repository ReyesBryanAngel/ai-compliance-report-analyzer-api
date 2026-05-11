import type { PrismaClient } from '../generated/prisma/client';
import { getParser } from '../parser';
import type { NormalizedTransaction } from '../parser/types';
import { runRiskEngine, SUPPORTED_WORKFLOWS } from '../risk-engine';
import type { WorkflowResult } from '../risk-engine/types';
import { loadSgThresholds } from '../thresholds/service';
import type {
  GenerateReportBody,
  GenerateReportResponse,
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
  const overallRiskScore =
    workflowResults.length > 0
      ? Math.max(...workflowResults.map((w) => w.overallScore))
      : 0;

  return {
    totalDocuments,
    totalTransactions,
    overallRiskScore,
    triggeredChecks: allFindings.filter((f) => f.triggered).length,
    highRiskFindings: allFindings.filter((f) => f.severity === 'high').length,
  };
}

export async function generateReport(
  body: GenerateReportBody,
  prisma: PrismaClient,
): Promise<GenerateReportResponse> {
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
      where: { batchId: batch_id },
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

  // Fetch and validate documents
  const documents = await prisma.document.findMany({
    where: { id: { in: resolvedIds } },
  });

  const foundIds = new Set(documents.map((d) => d.id));
  const missing = resolvedIds.filter((id) => !foundIds.has(id));
  if (missing.length > 0) {
    throw Object.assign(new Error(`Documents not found: ${missing.join(', ')}`), {
      code: 'NOT_FOUND',
    });
  }

  const notReady = documents.filter(
    (d) => d.status !== 'COMPLETED' && d.status !== 'PROCESSED',
  );
  if (notReady.length > 0) {
    throw Object.assign(
      new Error(
        `Documents not ready for analysis (status must be COMPLETED or PROCESSED): ${notReady.map((d) => `${d.id} [${d.status}]`).join(', ')}`,
      ),
      { code: 'NOT_READY' },
    );
  }

  const unparseable = documents.filter((d) => !getParser(d.mimeType));
  if (unparseable.length > 0) {
    throw Object.assign(
      new Error(
        `No parser available for: ${unparseable.map((d) => `${d.originalName} (${d.mimeType})`).join(', ')}`,
      ),
      { code: 'UNSUPPORTED_MIME' },
    );
  }

  const reportTitle =
    title ??
    `Compliance Report — ${new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })}`;

  const report = await prisma.report.create({
    data: {
      title: reportTitle,
      status: 'ANALYZING',
      documentIds: resolvedIds,
      workflows,
    },
  });

  try {
    const allTransactions: NormalizedTransaction[] = [];

    for (const doc of documents) {
      const parser = getParser(doc.mimeType)!;
      const { transactions } = await parser.parse(doc.path);
      allTransactions.push(...transactions);
    }

    const enabledCps = await prisma.checkpoint.findMany({
      where: { workflow: { slug: { in: workflows } }, enabled: true },
      select: { slug: true },
    });
    const enabledCheckpoints = new Set(enabledCps.map((cp) => cp.slug));

    const thresholds = {
      ...(workflows.includes('sg') ? { sg: await loadSgThresholds(prisma) } : {}),
    };
    const riskReport = runRiskEngine(allTransactions, workflows, { thresholds, enabledCheckpoints });

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

    const summary = buildSummary(riskReport.workflows, documents.length, allTransactions.length);

    await prisma.report.update({
      where: { id: report.id },
      data: {
        content: JSON.stringify({ summary, riskReport }),
        status: 'COMPLETED',
      },
    });

    return {
      id: report.id,
      title: reportTitle,
      status: 'COMPLETED',
      documentIds: resolvedIds,
      workflows,
      results: riskReport.workflows,
      checks: savedChecks,
      summary,
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

export async function getReport(
  reportId: string,
  prisma: PrismaClient,
): Promise<GenerateReportResponse> {
  const report = await prisma.report.findUnique({
    where: { id: reportId },
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
    createdAt: report.createdAt.toISOString(),
  };
}

export async function listReports(prisma: PrismaClient): Promise<ListReportItem[]> {
  const reports = await prisma.report.findMany({
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

  return reports.map((r) => {
    const parsed = r.content ? JSON.parse(r.content) : null;
    return {
      id: r.id,
      title: r.title ?? '',
      status: r.status,
      documentIds: r.documentIds,
      workflows: r.workflows,
      summary: parsed?.summary ?? null,
      createdAt: r.createdAt.toISOString(),
    };
  });
}
