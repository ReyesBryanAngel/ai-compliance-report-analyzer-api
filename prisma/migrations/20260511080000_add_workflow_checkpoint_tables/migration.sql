-- CreateTable
CREATE TABLE "workflows" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checkpoints" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "checkpoints_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workflows_slug_key" ON "workflows"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "checkpoints_workflowId_slug_key" ON "checkpoints"("workflowId", "slug");

-- AddForeignKey
ALTER TABLE "checkpoints" ADD CONSTRAINT "checkpoints_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Rebuild threshold_configs with checkpointId FK
-- Clear any existing rows (they used raw string columns; the new schema uses a FK)
DELETE FROM "threshold_configs";

-- Drop old unique index and columns
DROP INDEX "threshold_configs_workflow_checkpoint_key";
ALTER TABLE "threshold_configs" DROP COLUMN "workflow";
ALTER TABLE "threshold_configs" DROP COLUMN "checkpoint";

-- Add new checkpointId column
ALTER TABLE "threshold_configs" ADD COLUMN "checkpointId" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "threshold_configs_checkpointId_key" ON "threshold_configs"("checkpointId");

-- AddForeignKey
ALTER TABLE "threshold_configs" ADD CONSTRAINT "threshold_configs_checkpointId_fkey" FOREIGN KEY ("checkpointId") REFERENCES "checkpoints"("id") ON DELETE CASCADE ON UPDATE CASCADE;
