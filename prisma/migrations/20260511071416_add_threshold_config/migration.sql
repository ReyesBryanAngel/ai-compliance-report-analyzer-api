-- CreateTable
CREATE TABLE "threshold_configs" (
    "id" TEXT NOT NULL,
    "workflow" TEXT NOT NULL,
    "checkpoint" TEXT NOT NULL,
    "greenMax" INTEGER NOT NULL DEFAULT 1,
    "amberMax" INTEGER NOT NULL DEFAULT 2,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "threshold_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "threshold_configs_workflow_checkpoint_key" ON "threshold_configs"("workflow", "checkpoint");
