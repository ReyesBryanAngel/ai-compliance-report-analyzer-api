import type { PrismaClient } from '../generated/prisma/client';
import { parseDocument } from './service';

const BATCH_SIZE = 20; // matches the semaphore capacity in llama-parse.ts
const POLL_INTERVAL_MS = 5_000;

interface ParseJobRow {
  id: string;
  documentId: string;
  attempts: number;
  maxAttempts: number;
}

export class ParseQueueWorker {
  private running = false;
  private loopPromise: Promise<void> | null = null;
  private wakeResolve: (() => void) | null = null;

  async enqueue(documentId: string, prisma: PrismaClient): Promise<void> {
    await prisma.parseJob.upsert({
      where: { documentId },
      create: { documentId },
      update: { status: 'QUEUED', queuedAt: new Date(), error: null, startedAt: null, completedAt: null },
    });
    this.wake();
  }

  async start(prisma: PrismaClient): Promise<void> {
    // Re-queue any jobs that were PROCESSING when the server last shut down (crash recovery).
    await prisma.parseJob.updateMany({
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
  private async claimJobs(prisma: PrismaClient): Promise<ParseJobRow[]> {
    return prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<ParseJobRow[]>`
        SELECT id, "documentId", attempts, "maxAttempts"
        FROM parse_jobs
        WHERE status = 'QUEUED'
        ORDER BY "queuedAt" ASC
        LIMIT ${BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
      `;

      if (rows.length === 0) return [];

      for (const row of rows) {
        await tx.parseJob.update({
          where: { id: row.id },
          data: { status: 'PROCESSING', startedAt: new Date() },
        });
      }

      return rows;
    });
  }

  private async processJob(job: ParseJobRow, prisma: PrismaClient): Promise<void> {
    try {
      await parseDocument(job.documentId, prisma);
      await prisma.parseJob.update({
        where: { id: job.id },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });
    } catch (err) {
      const newAttempts = job.attempts + 1;
      const errorMsg = err instanceof Error ? err.message : String(err);

      if (newAttempts >= job.maxAttempts) {
        await prisma.parseJob.update({
          where: { id: job.id },
          data: { status: 'FAILED', attempts: newAttempts, error: errorMsg, completedAt: new Date() },
        });
      } else {
        // Return to QUEUED so the next loop iteration retries it.
        await prisma.parseJob.update({
          where: { id: job.id },
          data: { status: 'QUEUED', attempts: newAttempts, error: errorMsg, startedAt: null },
        });
      }
    }
  }
}
