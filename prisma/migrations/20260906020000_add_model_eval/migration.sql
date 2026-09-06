-- CreateTable
CREATE TABLE "model_eval_runs" (
    "id" TEXT NOT NULL,
    "taskSetName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "model_eval_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "model_eval_results" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "taskName" TEXT NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "reason" TEXT,
    "latencyMs" INTEGER NOT NULL,
    "tokensIn" INTEGER,
    "tokensOut" INTEGER,
    "costUsd" DOUBLE PRECISION,
    "textSample" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "model_eval_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "model_eval_runs_taskSetName_createdAt_idx" ON "model_eval_runs"("taskSetName", "createdAt");

-- CreateIndex
CREATE INDEX "model_eval_results_runId_idx" ON "model_eval_results"("runId");

-- CreateIndex
CREATE INDEX "model_eval_results_provider_model_taskName_createdAt_idx" ON "model_eval_results"("provider", "model", "taskName", "createdAt");

-- AddForeignKey
ALTER TABLE "model_eval_results" ADD CONSTRAINT "model_eval_results_runId_fkey" FOREIGN KEY ("runId") REFERENCES "model_eval_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
