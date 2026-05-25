-- Recreate DocumentStatus enum without PENDING and PROCESSED
ALTER TYPE "DocumentStatus" RENAME TO "DocumentStatus_old";
CREATE TYPE "DocumentStatus" AS ENUM ('PROCESSING', 'COMPLETED', 'FAILED');
ALTER TABLE "documents" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "documents" ALTER COLUMN "status" TYPE "DocumentStatus" USING (
  CASE "status"::text
    WHEN 'PENDING' THEN 'PROCESSING'
    WHEN 'PROCESSED' THEN 'COMPLETED'
    ELSE "status"::text
  END
)::"DocumentStatus";
ALTER TABLE "documents" ALTER COLUMN "status" SET DEFAULT 'PROCESSING'::"DocumentStatus";
DROP TYPE "DocumentStatus_old";

-- Recreate ReportStatus enum without PENDING and ANALYZING, add GENERATING
ALTER TYPE "ReportStatus" RENAME TO "ReportStatus_old";
CREATE TYPE "ReportStatus" AS ENUM ('GENERATING', 'COMPLETED', 'FAILED');
ALTER TABLE "reports" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "reports" ALTER COLUMN "status" TYPE "ReportStatus" USING (
  CASE "status"::text
    WHEN 'PENDING' THEN 'GENERATING'
    WHEN 'ANALYZING' THEN 'GENERATING'
    ELSE "status"::text
  END
)::"ReportStatus";
ALTER TABLE "reports" ALTER COLUMN "status" SET DEFAULT 'GENERATING'::"ReportStatus";
DROP TYPE "ReportStatus_old";
