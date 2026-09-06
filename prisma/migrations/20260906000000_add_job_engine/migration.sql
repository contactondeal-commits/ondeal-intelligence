-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'PLANNING', 'RUNNING', 'WAITING_RETRY', 'PAUSED', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "JobStepStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "JobArtifactKind" AS ENUM ('SCREENSHOT', 'FILE', 'DIFF', 'LOG', 'OTHER');

-- CreateTable
CREATE TABLE "jobs" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "inputJson" TEXT NOT NULL,
    "resultJson" TEXT,
    "lastError" TEXT,
    "currentStepIndex" INTEGER NOT NULL DEFAULT 0,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_steps" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
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

    CONSTRAINT "job_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_artifacts" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "stepId" TEXT,
    "kind" "JobArtifactKind" NOT NULL,
    "storageRef" TEXT NOT NULL,
    "metaJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "jobs_storeId_status_idx" ON "jobs"("storeId", "status");

-- CreateIndex
CREATE INDEX "jobs_status_createdAt_idx" ON "jobs"("status", "createdAt");

-- CreateIndex
CREATE INDEX "job_steps_jobId_index_attempt_idx" ON "job_steps"("jobId", "index", "attempt");

-- CreateIndex
CREATE INDEX "job_artifacts_jobId_idx" ON "job_artifacts"("jobId");

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_steps" ADD CONSTRAINT "job_steps_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_artifacts" ADD CONSTRAINT "job_artifacts_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_artifacts" ADD CONSTRAINT "job_artifacts_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "job_steps"("id") ON DELETE SET NULL ON UPDATE CASCADE;
