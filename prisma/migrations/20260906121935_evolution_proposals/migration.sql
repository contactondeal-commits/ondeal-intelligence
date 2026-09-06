-- CreateTable
CREATE TABLE "evolution_proposals" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "hypothesis" TEXT NOT NULL,
    "targetArea" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "coderMissionId" TEXT,
    "reviewedByUserId" TEXT,
    "reviewNote" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "shippedPrUrl" TEXT,
    "shippedBranch" TEXT,
    "shippedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "evolution_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "evolution_proposals_coderMissionId_key" ON "evolution_proposals"("coderMissionId");

-- CreateIndex
CREATE INDEX "evolution_proposals_status_createdAt_idx" ON "evolution_proposals"("status", "createdAt");
