/*
  Warnings:

  - You are about to drop the column `metadata` on the `reports` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "batchId" TEXT;

-- AlterTable
ALTER TABLE "reports" DROP COLUMN "metadata";

-- CreateTable
CREATE TABLE "document_batches" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_batches_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "document_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
