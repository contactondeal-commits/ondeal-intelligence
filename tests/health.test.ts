import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * ONDEAL AI CORE — FINAL PHASE : Observabilité réelle (06/09/2026) — /api/health.
 *
 * Verrouille : (1) 200 + status "ok" quand la base répond réellement,
 * (2) 503 + status "degraded" (jamais un 200 qui masquerait la panne à un
 * moniteur externe) quand la requête DB échoue, (3) le SHA de commit vient
 * de VERCEL_GIT_COMMIT_SHA quand présent, null sinon — jamais une valeur
 * inventée.
 */

const ENV_BACKUP = { ...process.env };

afterEach(() => {
  process.env = { ...ENV_BACKUP };
  vi.restoreAllMocks();
  vi.resetModules();
});

async function loadHealth(queryRaw: () => Promise<unknown>) {
  vi.resetModules();
  vi.doMock("@/lib/db", () => ({ prisma: { $queryRaw: queryRaw } }));
  return import("@/lib/observability/health");
}

describe("computeHealth", () => {
  it("status ok + database ok quand la base répond réellement", async () => {
    const { computeHealth } = await loadHealth(() => Promise.resolve([{ "?column?": 1 }]));
    const report = await computeHealth();
    expect(report.status).toBe("ok");
    expect(report.database).toBe("ok");
    expect(report.databaseError).toBeNull();
  });

  it("status degraded + database error (jamais un succès masqué) quand la requête DB échoue", async () => {
    const { computeHealth } = await loadHealth(() => Promise.reject(new Error("connexion refusée")));
    const report = await computeHealth();
    expect(report.status).toBe("degraded");
    expect(report.database).toBe("error");
    expect(report.databaseError).toBe("connexion refusée");
  });

  it("expose le VRAI SHA de commit Vercel quand présent, jamais une valeur inventée quand absent", async () => {
    process.env.VERCEL_GIT_COMMIT_SHA = "58e5b8ed44f853c43971dd0f544c5f6966384d47";
    process.env.VERCEL_ENV = "production";
    const { computeHealth } = await loadHealth(() => Promise.resolve([]));
    const report = await computeHealth();
    expect(report.commit).toBe("58e5b8ed44f853c43971dd0f544c5f6966384d47");
    expect(report.environment).toBe("production");

    delete process.env.VERCEL_GIT_COMMIT_SHA;
    delete process.env.VERCEL_ENV;
    const { computeHealth: computeHealthLocal } = await loadHealth(() => Promise.resolve([]));
    const localReport = await computeHealthLocal();
    expect(localReport.commit).toBeNull();
    expect(localReport.environment).toBe("development");
  });
});

describe("GET /api/health", () => {
  it("répond 200 quand la base est saine", async () => {
    vi.resetModules();
    vi.doMock("@/lib/observability/health", () => ({
      computeHealth: vi.fn().mockResolvedValue({ status: "ok", database: "ok", databaseError: null, commit: "abc123", environment: "production", timestamp: "2026-09-06T00:00:00.000Z" }),
    }));
    const { GET } = await import("@/app/api/health/route");
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).database).toBe("ok");
  });

  it("répond 503 (jamais 200) quand la base est en panne", async () => {
    vi.resetModules();
    vi.doMock("@/lib/observability/health", () => ({
      computeHealth: vi.fn().mockResolvedValue({ status: "degraded", database: "error", databaseError: "boom", commit: null, environment: "development", timestamp: "2026-09-06T00:00:00.000Z" }),
    }));
    const { GET } = await import("@/app/api/health/route");
    const res = await GET();
    expect(res.status).toBe(503);
    expect((await res.json()).database).toBe("error");
  });
});
