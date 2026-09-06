-- AlterTable
ALTER TABLE "storefront_missions" ADD COLUMN     "instructionsJson" TEXT,
ADD COLUMN     "pendingInstruction" TEXT;

-- CreateTable
CREATE TABLE "platform_integrations" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NOT_CONNECTED',
    "encryptedCredentials" TEXT,
    "scopesJson" TEXT,
    "connectedByUserId" TEXT,
    "lastHealthCheckAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "model_configs" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "forceForTestUntil" TIMESTAMP(3),
    "maxCostPerCallUsd" DOUBLE PRECISION,
    "providerPriority" INTEGER NOT NULL DEFAULT 0,
    "updatedByUserId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "model_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memory_records" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "storeId" TEXT,
    "missionId" TEXT,
    "content" TEXT NOT NULL,
    "metaJson" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "sourceKind" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "memory_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "experiment_runs" (
    "id" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "dimension" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "winnerVariantId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "experiment_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "experiment_variants" (
    "id" TEXT NOT NULL,
    "experimentId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "provider" TEXT,
    "model" TEXT,
    "promptVariant" TEXT,
    "outputText" TEXT,
    "costUsd" DOUBLE PRECISION,
    "latencyMs" INTEGER,
    "score" DOUBLE PRECISION,
    "scoreReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "experiment_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_owner_credentials" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "publicKey" BYTEA NOT NULL,
    "counter" BIGINT NOT NULL DEFAULT 0,
    "transports" TEXT,
    "deviceLabel" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "platform_owner_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_owner_recovery_codes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_owner_recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_owner_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assuranceLevel" TEXT NOT NULL DEFAULT 'L2_PASSKEY',
    "stepUpExpiresAt" TIMESTAMP(3),
    "credentialId" TEXT NOT NULL,
    "userAgent" TEXT,
    "ipHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,

    CONSTRAINT "platform_owner_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_owner_webauthn_challenges" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "challenge" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_owner_webauthn_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_integrations_provider_key" ON "platform_integrations"("provider");

-- CreateIndex
CREATE UNIQUE INDEX "model_configs_provider_model_key" ON "model_configs"("provider", "model");

-- CreateIndex
CREATE INDEX "memory_records_scope_storeId_idx" ON "memory_records"("scope", "storeId");

-- CreateIndex
CREATE INDEX "memory_records_missionId_idx" ON "memory_records"("missionId");

-- CreateIndex
CREATE INDEX "experiment_variants_experimentId_idx" ON "experiment_variants"("experimentId");

-- CreateIndex
CREATE UNIQUE INDEX "platform_owner_credentials_credentialId_key" ON "platform_owner_credentials"("credentialId");

-- CreateIndex
CREATE INDEX "platform_owner_credentials_userId_idx" ON "platform_owner_credentials"("userId");

-- CreateIndex
CREATE INDEX "platform_owner_recovery_codes_userId_idx" ON "platform_owner_recovery_codes"("userId");

-- CreateIndex
CREATE INDEX "platform_owner_sessions_userId_revokedAt_idx" ON "platform_owner_sessions"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "platform_owner_webauthn_challenges_userId_kind_idx" ON "platform_owner_webauthn_challenges"("userId", "kind");

-- AddForeignKey
ALTER TABLE "experiment_variants" ADD CONSTRAINT "experiment_variants_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "experiment_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
