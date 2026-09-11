-- CreateEnum
CREATE TYPE "ConversationMessageRole" AS ENUM ('USER', 'ASSISTANT');

-- CreateTable
CREATE TABLE "report_conversations" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "report_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_conversation_messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" "ConversationMessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "model" TEXT,
    "provider" TEXT,
    "promptTokens" INTEGER,
    "completionTokens" INTEGER,
    "latencyMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_conversation_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "report_conversations_reportId_idx" ON "report_conversations"("reportId");

-- CreateIndex
CREATE INDEX "report_conversation_messages_conversationId_sequence_idx" ON "report_conversation_messages"("conversationId", "sequence");

-- AddForeignKey
ALTER TABLE "report_conversations" ADD CONSTRAINT "report_conversations_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_conversations" ADD CONSTRAINT "report_conversations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_conversation_messages" ADD CONSTRAINT "report_conversation_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "report_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
