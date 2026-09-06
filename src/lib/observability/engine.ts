import { prisma } from "@/lib/db";

/**
 * ONDEAL AI CORE — FINAL PHASE : Observabilité réelle (06/09/2026), volet
 * Owner Cockpit. Distinct du Outcome/ROI Engine (résultat métier/business
 * value) et de AiLabAuditLog (journal chronologique détaillé, déjà
 * consultable onglet "audit") : ici, la question posée est opérationnelle —
 * "le système est-il en train de bien fonctionner MAINTENANT / ces
 * dernières 24h", jamais "combien ça rapporte" ni "que s'est-il passé
 * exactement". Même discipline "NO CAPABILITY THEATER" que outcomes/
 * engine.ts : chaque nombre vient d'une vraie requête Prisma, un
 * dénominateur nul retourne `null`, jamais un taux fabriqué.
 */

const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;
const STALE_SYNC_THRESHOLD_MS = 48 * 60 * 60 * 1000;
const STUCK_MISSION_THRESHOLD_MS = 2 * 60 * 60 * 1000;

export interface ObservabilitySummary {
  sync: {
    last24h: { total: number; byStatus: Record<string, number> };
    staleConnectedIntegrations: Array<{ storeId: string; storeName: string; provider: string; lastSyncedAt: string | null }>;
  };
  aiLabAudit: {
    last24h: { total: number; byResultStatus: Record<string, number>; failureRatePct: number | null };
  };
  jobs: {
    byStatus: Record<string, number>;
    failedLast24h: number;
  };
  coderMissions: {
    byStatus: Record<string, number>;
    failedLast24h: number;
    stuck: Array<{ id: string; goal: string; status: string; startedAt: string | null }>;
  };
  storefrontMissions: {
    byStatus: Record<string, number>;
    failedLast24h: number;
    stuck: Array<{ id: string; goal: string; status: string; startedAt: string | null }>;
  };
  generatedAt: string;
}

function ratio(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function statusMap(rows: Array<{ status: string; _count: { _all: number } }>): Record<string, number> {
  const map: Record<string, number> = {};
  for (const row of rows) map[row.status] = row._count._all;
  return map;
}

export async function computeObservabilitySummary(): Promise<ObservabilitySummary> {
  const now = new Date();
  const since24h = new Date(now.getTime() - RECENT_WINDOW_MS);
  const staleBefore = new Date(now.getTime() - STALE_SYNC_THRESHOLD_MS);
  const stuckBefore = new Date(now.getTime() - STUCK_MISSION_THRESHOLD_MS);

  const [
    syncRuns24h,
    staleIntegrations,
    auditLogs24h,
    jobsByStatus,
    jobsFailed24h,
    coderMissionsByStatus,
    coderMissionsFailed24h,
    coderMissionsStuck,
    storefrontMissionsByStatus,
    storefrontMissionsFailed24h,
    storefrontMissionsStuck,
  ] = await Promise.all([
    prisma.syncRun.groupBy({ by: ["status"], where: { startedAt: { gte: since24h } }, _count: { _all: true } }),
    // Boutique RÉELLE (jamais démo), intégration CONNECTED, jamais synchronisée
    // OU dont la dernière synchro remonte à plus de 48h — signal réel d'un
    // pipeline de synchro bloqué, jamais une supposition.
    prisma.integration.findMany({
      where: {
        status: "CONNECTED",
        store: { isDemo: false },
        OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: staleBefore } }],
      },
      select: { provider: true, lastSyncedAt: true, store: { select: { id: true, name: true } } },
      take: 200,
    }),
    prisma.aiLabAuditLog.groupBy({ by: ["resultStatus"], where: { createdAt: { gte: since24h }, resultStatus: { not: null } }, _count: { _all: true } }),
    prisma.job.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.job.count({ where: { status: "FAILED", updatedAt: { gte: since24h } } }),
    prisma.coderMission.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.coderMission.count({ where: { status: "FAILED", updatedAt: { gte: since24h } } }),
    prisma.coderMission.findMany({
      where: { status: { in: ["RUNNING", "PLANNING"] }, startedAt: { lt: stuckBefore } },
      select: { id: true, goal: true, status: true, startedAt: true },
      take: 50,
    }),
    prisma.storefrontMission.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.storefrontMission.count({ where: { status: "FAILED", updatedAt: { gte: since24h } } }),
    prisma.storefrontMission.findMany({
      where: { status: { in: ["RUNNING", "PLANNING"] }, startedAt: { lt: stuckBefore } },
      select: { id: true, goal: true, status: true, startedAt: true },
      take: 50,
    }),
  ]);

  const syncStatusMap = statusMap(syncRuns24h);
  const syncTotal = Object.values(syncStatusMap).reduce((a, b) => a + b, 0);

  const auditStatusMap: Record<string, number> = {};
  for (const row of auditLogs24h) if (row.resultStatus) auditStatusMap[row.resultStatus] = row._count._all;
  const auditTotal = Object.values(auditStatusMap).reduce((a, b) => a + b, 0);
  const auditFailures = auditStatusMap["FAILURE"] ?? 0;

  return {
    sync: {
      last24h: { total: syncTotal, byStatus: syncStatusMap },
      staleConnectedIntegrations: staleIntegrations.map((i) => ({
        storeId: i.store.id,
        storeName: i.store.name,
        provider: i.provider,
        lastSyncedAt: i.lastSyncedAt ? i.lastSyncedAt.toISOString() : null,
      })),
    },
    aiLabAudit: {
      last24h: { total: auditTotal, byResultStatus: auditStatusMap, failureRatePct: ratio(auditFailures, auditTotal) },
    },
    jobs: {
      byStatus: statusMap(jobsByStatus),
      failedLast24h: jobsFailed24h,
    },
    coderMissions: {
      byStatus: statusMap(coderMissionsByStatus),
      failedLast24h: coderMissionsFailed24h,
      stuck: coderMissionsStuck.map((m) => ({ id: m.id, goal: m.goal, status: m.status, startedAt: m.startedAt ? m.startedAt.toISOString() : null })),
    },
    storefrontMissions: {
      byStatus: statusMap(storefrontMissionsByStatus),
      failedLast24h: storefrontMissionsFailed24h,
      stuck: storefrontMissionsStuck.map((m) => ({ id: m.id, goal: m.goal, status: m.status, startedAt: m.startedAt ? m.startedAt.toISOString() : null })),
    },
    generatedAt: now.toISOString(),
  };
}
