-- AlterTable
ALTER TABLE "storefront_missions" ADD COLUMN     "autonomyLevel" TEXT NOT NULL DEFAULT 'ASSIST',
ADD COLUMN     "environment" TEXT NOT NULL DEFAULT 'SANDBOX',
ADD COLUMN     "forcedModel" TEXT,
ADD COLUMN     "hardBudgetUsd" DOUBLE PRECISION,
ADD COLUMN     "storeId" TEXT;

-- CreateTable
CREATE TABLE "ai_lab_attachments" (
    "id" TEXT NOT NULL,
    "missionId" TEXT,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storageRef" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "parseStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "parseError" TEXT,
    "extractedText" TEXT,
    "uploadedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_lab_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_policy" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "killSwitchEngaged" BOOLEAN NOT NULL DEFAULT false,
    "killSwitchReason" TEXT,
    "defaultAutonomyLevel" TEXT NOT NULL DEFAULT 'ASSIST',
    "maxHardBudgetUsdGlobal" DOUBLE PRECISION NOT NULL DEFAULT 20,
    "productionEffectsAllowed" BOOLEAN NOT NULL DEFAULT false,
    "updatedByUserId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_policy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_lab_audit_logs" (
    "id" TEXT NOT NULL,
    "missionId" TEXT,
    "nodeKey" TEXT,
    "actorUserId" TEXT,
    "agentRole" TEXT,
    "provider" TEXT,
    "model" TEXT,
    "toolId" TEXT,
    "connectorId" TEXT,
    "storeId" TEXT,
    "action" TEXT NOT NULL,
    "decision" TEXT,
    "riskClass" TEXT,
    "reason" TEXT NOT NULL,
    "costUsd" DOUBLE PRECISION,
    "resultStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_lab_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_lab_attachments_missionId_idx" ON "ai_lab_attachments"("missionId");

-- CreateIndex
CREATE INDEX "ai_lab_audit_logs_missionId_idx" ON "ai_lab_audit_logs"("missionId");

-- CreateIndex
CREATE INDEX "ai_lab_audit_logs_createdAt_idx" ON "ai_lab_audit_logs"("createdAt");

-- CreateIndex
CREATE INDEX "storefront_missions_storeId_idx" ON "storefront_missions"("storeId");

-- AddForeignKey
ALTER TABLE "storefront_missions" ADD CONSTRAINT "storefront_missions_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_lab_attachments" ADD CONSTRAINT "ai_lab_attachments_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "storefront_missions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_lab_audit_logs" ADD CONSTRAINT "ai_lab_audit_logs_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "storefront_missions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
