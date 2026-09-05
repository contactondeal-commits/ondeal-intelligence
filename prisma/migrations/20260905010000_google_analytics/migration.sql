-- AlterEnum
ALTER TYPE "IntegrationProvider" ADD VALUE 'GOOGLE_ANALYTICS';

-- CreateTable
CREATE TABLE "analytics_snapshots" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "sessions" INTEGER NOT NULL,
    "activeUsers" INTEGER NOT NULL,
    "newUsers" INTEGER NOT NULL,
    "conversions" INTEGER NOT NULL,
    "revenue" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "analytics_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_channel_snapshots" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "sourceMedium" TEXT NOT NULL,
    "sessions" INTEGER NOT NULL,
    "conversions" INTEGER NOT NULL,
    "revenue" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "analytics_channel_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "analytics_snapshots_storeId_date_idx" ON "analytics_snapshots"("storeId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "analytics_snapshots_storeId_date_key" ON "analytics_snapshots"("storeId", "date");

-- CreateIndex
CREATE INDEX "analytics_channel_snapshots_storeId_date_idx" ON "analytics_channel_snapshots"("storeId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "analytics_channel_snapshots_storeId_date_sourceMedium_key" ON "analytics_channel_snapshots"("storeId", "date", "sourceMedium");

-- AddForeignKey
ALTER TABLE "analytics_snapshots" ADD CONSTRAINT "analytics_snapshots_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics_channel_snapshots" ADD CONSTRAINT "analytics_channel_snapshots_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

