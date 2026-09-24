import type { PrismaClient } from '../generated/prisma/client';
import type { NormalizedTransaction } from '../parser/types';
import { processReport } from './service';

const BATCH_SIZE = Number(process.env.REPORT_QUEUE_CONCURRENCY) || 3;
const POLL_INTERVAL_MS = 5_000;

interface ReportJobRow {
  id: string;
  reportId: string;
  documentId: string;
  workflow: string;
  attempts: number;
  maxAttempts: number;
}

export class ReportQueueWorker {
  private running = false;
  private loopPromise: Promise<void> | null = null;
  private wakeResolve: (() => void) | null = null;

  async enqueue(reportId: string, documentId: string, workflow: string, prisma: PrismaClient): Promise<void> {
    await prisma.reportJob.upsert({
      where: { reportId },
      create: { reportId, documentId, workflow },
      update: { status: 'QUEUED', queuedAt: new Date(), error: null, startedAt: null, completedAt: null },
    });
    this.wake();
  }

  async start(prisma: PrismaClient): Promise<void> {
    // Re-queue any jobs that were PROCESSING when the server last shut down (crash recovery).
    await prisma.reportJob.updateMany({
      where: { status: 'PROCESSING' },
      data: { status: 'QUEUED', startedAt: null },
    });

    this.running = true;
    this.loopPromise = this.loop(prisma);
  }

  async stop(): Promise<void> {
    this.running = false;
    this.wake(); // break out of sleep if currently waiting
    if (this.loopPromise) await this.loopPromise;
  }

  private wake(): void {
    if (this.wakeResolve) {
      const resolve = this.wakeResolve;
      this.wakeResolve = null;
      resolve();
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      this.wakeResolve = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }

  private async loop(prisma: PrismaClient): Promise<void> {
    while (this.running) {
      try {
        const jobs = await this.claimJobs(prisma);

        if (jobs.length === 0) {
          await this.sleep(POLL_INTERVAL_MS);
          continue;
        }

        await Promise.allSettled(jobs.map((job) => this.processJob(job, prisma)));
      } catch {
        await this.sleep(POLL_INTERVAL_MS);
      }
    }
  }

  // Atomically claims a batch of QUEUED jobs using SELECT FOR UPDATE SKIP LOCKED
  // so concurrent replicas never double-process the same job.
  //
  // Jobs are claimed round-robin across tenants rather than strictly FIFO: each tenant's
  // oldest job ranks 1, its second-oldest ranks 2, and so on, so one tenant's large backlog
  // can't starve another tenant's single job. A tenant is the report's organization, falling
  // back to its user (then the report itself) so org-less users aren't lumped into one bucket.
  private async claimJobs(prisma: PrismaClient): Promise<ReportJobRow[]> {
    return prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<ReportJobRow[]>`
        WITH ranked AS (
          SELECT
            j.id,
            j."queuedAt",
            ROW_NUMBER() OVER (
              PARTITION BY COALESCE(r."organizationId", r."userId", r.id)
              ORDER BY j."queuedAt" ASC
            ) AS tenant_rank
          FROM report_jobs j
          JOIN reports r ON r.id = j."reportId"
          WHERE j.status = 'QUEUED'
        )
        SELECT j.id, j."reportId", j."documentId", j.workflow, j.attempts, j."maxAttempts"
        FROM report_jobs j
        JOIN ranked ON ranked.id = j.id
        WHERE j.status = 'QUEUED'
        ORDER BY ranked.tenant_rank ASC, ranked."queuedAt" ASC
        LIMIT ${BATCH_SIZE}
        FOR UPDATE OF j SKIP LOCKED
      `;

      if (rows.length === 0) return [];

      for (const row of rows) {
        await tx.reportJob.update({
          where: { id: row.id },
          data: { status: 'PROCESSING', startedAt: new Date() },
        });
      }

      return rows;
    });
  }

  private async processJob(job: ReportJobRow, prisma: PrismaClient): Promise<void> {
    try {
      const [report, doc] = await Promise.all([
        prisma.report.findUnique({ where: { id: job.reportId } }),
        prisma.document.findUnique({ where: { id: job.documentId } }),
      ]);
      if (!report) throw new Error(`Report ${job.reportId} not found`);
      if (!doc) throw new Error(`Document ${job.documentId} not found`);

      const transactions = doc.parsedData as NormalizedTransaction[];

      await processReport(
        { id: report.id, createdAt: report.createdAt },
        report.title ?? '',
        { id: doc.id, originalName: doc.originalName, batchId: doc.batchId },
        transactions,
        job.workflow,
        prisma,
        report.organizationId,
      );

      await prisma.reportJob.update({
        where: { id: job.id },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });
    } catch (err) {
      const newAttempts = job.attempts + 1;
      const errorMsg = err instanceof Error ? err.message : String(err);

      if (newAttempts >= job.maxAttempts) {
        await prisma.reportJob.update({
          where: { id: job.id },
          data: { status: 'FAILED', attempts: newAttempts, error: errorMsg, completedAt: new Date() },
        });
      } else {
        // Return to QUEUED so the next loop iteration retries it.
        await prisma.reportJob.update({
          where: { id: job.id },
          data: { status: 'QUEUED', attempts: newAttempts, error: errorMsg, startedAt: null },
        });
      }
    }
  }
}
