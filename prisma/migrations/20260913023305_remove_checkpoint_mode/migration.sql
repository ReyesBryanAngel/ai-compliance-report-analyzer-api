-- DropForeignKey
ALTER TABLE "org_checkpoint_overrides" DROP CONSTRAINT "org_checkpoint_overrides_checkpointId_fkey";

-- DropForeignKey
ALTER TABLE "org_checkpoint_overrides" DROP CONSTRAINT "org_checkpoint_overrides_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "org_threshold_configs" DROP CONSTRAINT "org_threshold_configs_checkpointId_fkey";

-- DropForeignKey
ALTER TABLE "org_threshold_configs" DROP CONSTRAINT "org_threshold_configs_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "org_workflow_configs" DROP CONSTRAINT "org_workflow_configs_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "org_workflow_configs" DROP CONSTRAINT "org_workflow_configs_workflowId_fkey";

-- AlterTable
ALTER TABLE "checkpoints" DROP COLUMN "enabled";

-- AlterTable
ALTER TABLE "workflow_executions" DROP COLUMN "mode";

-- DropTable
DROP TABLE "org_checkpoint_overrides";

-- DropTable
DROP TABLE "org_threshold_configs";

-- DropTable
DROP TABLE "org_workflow_configs";

-- DropEnum
DROP TYPE "WorkflowMode";
