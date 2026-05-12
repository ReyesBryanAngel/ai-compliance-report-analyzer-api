/*
  Warnings:

  - You are about to drop the column `organizationId` on the `reports` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "reports" DROP CONSTRAINT "reports_organizationId_fkey";

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "uploadedById" TEXT;

-- AlterTable
ALTER TABLE "reports" DROP COLUMN "organizationId";

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
