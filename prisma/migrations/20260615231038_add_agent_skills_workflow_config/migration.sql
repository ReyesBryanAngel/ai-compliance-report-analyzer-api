-- CreateEnum
CREATE TYPE "WorkflowMode" AS ENUM ('CHECKPOINTS', 'AGENT_SKILL');

-- CreateTable
CREATE TABLE "org_workflow_configs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "mode" "WorkflowMode" NOT NULL DEFAULT 'CHECKPOINTS',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "org_workflow_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_skill_instructions" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "organizationId" TEXT,
    "version" INTEGER NOT NULL,
    "title" TEXT,
    "content" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_skill_instructions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "org_workflow_configs_organizationId_workflowId_key" ON "org_workflow_configs"("organizationId", "workflowId");

-- CreateIndex
CREATE UNIQUE INDEX "agent_skill_instructions_workflowId_organizationId_version_key" ON "agent_skill_instructions"("workflowId", "organizationId", "version");

-- AddForeignKey
ALTER TABLE "org_workflow_configs" ADD CONSTRAINT "org_workflow_configs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_workflow_configs" ADD CONSTRAINT "org_workflow_configs_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_skill_instructions" ADD CONSTRAINT "agent_skill_instructions_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_skill_instructions" ADD CONSTRAINT "agent_skill_instructions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_skill_instructions" ADD CONSTRAINT "agent_skill_instructions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
