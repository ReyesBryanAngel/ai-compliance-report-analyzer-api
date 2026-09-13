-- CreateEnum
CREATE TYPE "ReportJobStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "report_jobs" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "workflow" TEXT NOT NULL,
    "status" "ReportJobStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "error" TEXT,
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "report_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "report_jobs_reportId_key" ON "report_jobs"("reportId");

-- CreateIndex
CREATE INDEX "report_jobs_status_queuedAt_idx" ON "report_jobs"("status", "queuedAt");

-- CreateIndex
CREATE INDEX "report_jobs_documentId_idx" ON "report_jobs"("documentId");

-- AddForeignKey
ALTER TABLE "report_jobs" ADD CONSTRAINT "report_jobs_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_jobs" ADD CONSTRAINT "report_jobs_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
