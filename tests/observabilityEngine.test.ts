import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * ONDEAL AI CORE — FINAL PHASE : Observabilité réelle (06/09/2026), volet
 * Owner Cockpit — computeObservabilitySummary(). Même discipline que
 * outcomeEngine.test.ts : mocks Prisma réels, jamais une valeur inventée
 * dans le module testé lui-même.
 */

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

interface MockData {
  syncRuns24h?: Array<{ status: string; _count: { _all: number } }>;
  staleIntegrations?: Array<{ provider: string; lastSyncedAt: Date | null; store: { id: string; name: string } }>;
  auditLogs24h?: Array<{ resultStatus: string | null; _count: { _all: number } }>;
  jobsByStatus?: Array<{ status: string; _count: { _all: number } }>;
  jobsFailed24h?: number;
  coderMissionsByStatus?: Array<{ status: string; _count: { _all: number } }>;
  coderMissionsFailed24h?: number;
  coderMissionsStuck?: Array<{ id: string; goal: string; status: string; startedAt: Date | null }>;
  storefrontMissionsByStatus?: Array<{ status: string; _count: { _all: number } }>;
  storefrontMissionsFailed24h?: number;
  storefrontMissionsStuck?: Array<{ id: string; goal: string; status: string; startedAt: Date | null }>;
}

async function loadEngine(data: MockData) {
  vi.resetModules();
  vi.doMock("@/lib/db", () => ({
    prisma: {
      syncRun: { groupBy: vi.fn().mockResolvedValue(data.syncRuns24h ?? []) },
      integration: { findMany: vi.fn().mockResolvedValue(data.staleIntegrations ?? []) },
      aiLabAuditLog: { groupBy: vi.fn().mockResolvedValue(data.auditLogs24h ?? []) },
      job: {
        groupBy: vi.fn().mockResolvedValue(data.jobsByStatus ?? []),
        count: vi.fn().mockResolvedValue(data.jobsFailed24h ?? 0),
      },
      coderMission: {
        groupBy: vi.fn().mockResolvedValue(data.coderMissionsByStatus ?? []),
        count: vi.fn().mockResolvedValue(data.coderMissionsFailed24h ?? 0),
        findMany: vi.fn().mockResolvedValue(data.coderMissionsStuck ?? []),
      },
      storefrontMission: {
        groupBy: vi.fn().mockResolvedValue(data.storefrontMissionsByStatus ?? []),
        count: vi.fn().mockResolvedValue(data.storefrontMissionsFailed24h ?? 0),
        findMany: vi.fn().mockResolvedValue(data.storefrontMissionsStuck ?? []),
      },
    },
  }));
  return import("@/lib/observability/engine");
}

describe("computeObservabilitySummary", () => {
  it("agrège les statuts de synchro réels des 24h et calcule le taux d'échec AI Lab sans dénominateur nul fabriqué", async () => {
    const { computeObservabilitySummary } = await loadEngine({
      syncRuns24h: [{ status: "success", _count: { _all: 8 } }, { status: "error", _count: { _all: 2 } }],
      auditLogs24h: [{ resultStatus: "SUCCESS", _count: { _all: 18 } }, { resultStatus: "FAILURE", _count: { _all: 2 } }],
    });
    const summary = await computeObservabilitySummary();
    expect(summary.sync.last24h).toEqual({ total: 10, byStatus: { success: 8, error: 2 } });
    expect(summary.aiLabAudit.last24h.failureRatePct).toBe(10); // 2/20 = 10%
  });

  it("failureRatePct est null (jamais 0% fabriqué) quand aucun événement AI Lab audité sur 24h", async () => {
    const { computeObservabilitySummary } = await loadEngine({});
    const summary = await computeObservabilitySummary();
    expect(summary.aiLabAudit.last24h.total).toBe(0);
    expect(summary.aiLabAudit.last24h.failureRatePct).toBeNull();
  });

  it("expose les intégrations connectées réellement en retard de synchro (boutique réelle, jamais démo — filtré en amont côté Prisma)", async () => {
    const { computeObservabilitySummary } = await loadEngine({
      staleIntegrations: [{ provider: "SHOPIFY", lastSyncedAt: null, store: { id: "s1", name: "Boutique en retard" } }],
    });
    const summary = await computeObservabilitySummary();
    expect(summary.sync.staleConnectedIntegrations).toEqual([{ storeId: "s1", storeName: "Boutique en retard", provider: "SHOPIFY", lastSyncedAt: null }]);
  });

  it("expose les missions Coder/Storefront réellement bloquées (RUNNING/PLANNING depuis plus de 2h)", async () => {
    const stuckAt = new Date("2026-09-06T10:00:00.000Z");
    const { computeObservabilitySummary } = await loadEngine({
      coderMissionsStuck: [{ id: "cm1", goal: "Corriger le bug X", status: "RUNNING", startedAt: stuckAt }],
      storefrontMissionsStuck: [{ id: "sm1", goal: "Optimiser la fiche Y", status: "PLANNING", startedAt: stuckAt }],
    });
    const summary = await computeObservabilitySummary();
    expect(summary.coderMissions.stuck).toEqual([{ id: "cm1", goal: "Corriger le bug X", status: "RUNNING", startedAt: stuckAt.toISOString() }]);
    expect(summary.storefrontMissions.stuck).toEqual([{ id: "sm1", goal: "Optimiser la fiche Y", status: "PLANNING", startedAt: stuckAt.toISOString() }]);
  });

  it("reporte fidèlement les compteurs d'échec 24h et la distribution de statuts des Jobs, sans les mélanger aux missions", async () => {
    const { computeObservabilitySummary } = await loadEngine({
      jobsByStatus: [{ status: "SUCCEEDED", _count: { _all: 5 } }, { status: "FAILED", _count: { _all: 1 } }],
      jobsFailed24h: 1,
      coderMissionsFailed24h: 0,
      storefrontMissionsFailed24h: 3,
    });
    const summary = await computeObservabilitySummary();
    expect(summary.jobs).toEqual({ byStatus: { SUCCEEDED: 5, FAILED: 1 }, failedLast24h: 1 });
    expect(summary.coderMissions.failedLast24h).toBe(0);
    expect(summary.storefrontMissions.failedLast24h).toBe(3);
  });
});
