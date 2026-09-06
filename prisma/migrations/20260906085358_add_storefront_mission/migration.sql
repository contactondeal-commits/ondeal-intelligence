-- CreateTable
CREATE TABLE "storefront_missions" (
    "id" TEXT NOT NULL,
    "goal" TEXT NOT NULL,
    "constraintsJson" TEXT,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "createdByUserId" TEXT NOT NULL,
    "worldStateJson" TEXT,
    "resultJson" TEXT,
    "lastError" TEXT,
    "totalCostUsd" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "storefront_missions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storefront_mission_nodes" (
    "id" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "dependsOnJson" TEXT,
    "status" "JobStepStatus" NOT NULL DEFAULT 'PENDING',
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "inputJson" TEXT,
    "outputJson" TEXT,
    "confidence" DOUBLE PRECISION,
    "errorJson" TEXT,
    "provider" TEXT,
    "model" TEXT,
    "costUsd" DOUBLE PRECISION,
    "tokensIn" INTEGER,
    "tokensOut" INTEGER,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "storefront_mission_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storefront_mission_artifacts" (
    "id" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "nodeId" TEXT,
    "kind" "JobArtifactKind" NOT NULL,
    "storageRef" TEXT NOT NULL,
    "metaJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "storefront_mission_artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "storefront_missions_status_createdAt_idx" ON "storefront_missions"("status", "createdAt");

-- CreateIndex
CREATE INDEX "storefront_mission_nodes_missionId_status_idx" ON "storefront_mission_nodes"("missionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "storefront_mission_nodes_missionId_key_key" ON "storefront_mission_nodes"("missionId", "key");

-- CreateIndex
CREATE INDEX "storefront_mission_artifacts_missionId_idx" ON "storefront_mission_artifacts"("missionId");

-- AddForeignKey
ALTER TABLE "storefront_mission_nodes" ADD CONSTRAINT "storefront_mission_nodes_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "storefront_missions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storefront_mission_artifacts" ADD CONSTRAINT "storefront_mission_artifacts_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "storefront_missions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storefront_mission_artifacts" ADD CONSTRAINT "storefront_mission_artifacts_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "storefront_mission_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
