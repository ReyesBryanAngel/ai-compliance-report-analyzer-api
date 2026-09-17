-- DropForeignKey
ALTER TABLE "checkpoints" DROP CONSTRAINT "checkpoints_workflowId_fkey";

-- DropTable
DROP TABLE "checkpoints";
