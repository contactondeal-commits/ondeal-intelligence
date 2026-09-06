-- CreateTable
CREATE TABLE "coder_missions" (
    "id" TEXT NOT NULL,
    "goal" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "currentStepIndex" INTEGER NOT NULL DEFAULT 0,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "createdByUserId" TEXT NOT NULL,
    "resultJson" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "coder_missions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coder_mission_steps" (
    "id" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "name" TEXT NOT NULL,
    "status" "JobStepStatus" NOT NULL DEFAULT 'PENDING',
    "inputJson" TEXT,
    "outputJson" TEXT,
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

    CONSTRAINT "coder_mission_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coder_mission_artifacts" (
    "id" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "stepId" TEXT,
    "kind" "JobArtifactKind" NOT NULL,
    "storageRef" TEXT NOT NULL,
    "metaJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coder_mission_artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "coder_missions_status_createdAt_idx" ON "coder_missions"("status", "createdAt");

-- CreateIndex
CREATE INDEX "coder_mission_steps_missionId_index_attempt_idx" ON "coder_mission_steps"("missionId", "index", "attempt");

-- CreateIndex
CREATE INDEX "coder_mission_artifacts_missionId_idx" ON "coder_mission_artifacts"("missionId");

-- AddForeignKey
ALTER TABLE "coder_mission_steps" ADD CONSTRAINT "coder_mission_steps_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "coder_missions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coder_mission_artifacts" ADD CONSTRAINT "coder_mission_artifacts_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "coder_missions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coder_mission_artifacts" ADD CONSTRAINT "coder_mission_artifacts_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "coder_mission_steps"("id") ON DELETE SET NULL ON UPDATE CASCADE;
