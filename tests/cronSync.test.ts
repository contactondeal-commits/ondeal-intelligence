import { describe, it, expect, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

// Route /api/cron/sync (04/09/2026, mise à jour pour appeler syncCatalog au
// lieu de syncShopify en dur — voir src/lib/sync/pipeline.ts — pour que la
// synchro planifiée couvre aussi les boutiques WooCommerce/PrestaShop).

const ENV_BACKUP = { ...process.env };

afterEach(() => {
  process.env = { ...ENV_BACKUP };
  vi.restoreAllMocks();
  vi.resetModules();
});

function makeRequest(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("http://localhost/api/cron/sync", { headers });
}

describe("isAuthorized", () => {
  it("refuse si CRON_SECRET n'est pas défini", async () => {
    delete process.env.CRON_SECRET;
    const { isAuthorized } = await import("@/app/api/cron/sync/route");
    expect(isAuthorized(makeRequest({ authorization: "Bearer x" }))).toBe(false);
  });

  it("refuse si l'en-tête Authorization ne correspond pas", async () => {
    process.env.CRON_SECRET = "le-vrai-secret";
    const { isAuthorized } = await import("@/app/api/cron/sync/route");
    expect(isAuthorized(makeRequest({ authorization: "Bearer mauvais" }))).toBe(false);
    expect(isAuthorized(makeRequest({}))).toBe(false);
  });

  it("autorise quand l'en-tête correspond exactement", async () => {
    process.env.CRON_SECRET = "le-vrai-secret";
    const { isAuthorized } = await import("@/app/api/cron/sync/route");
    expect(isAuthorized(makeRequest({ authorization: "Bearer le-vrai-secret" }))).toBe(true);
  });
});

describe("GET /api/cron/sync", () => {
  it("répond 401 sans secret valide, sans toucher à la base", async () => {
    delete process.env.CRON_SECRET;
    vi.resetModules();
    const findManyStore = vi.fn();
    vi.doMock("@/lib/db", () => ({ prisma: { store: { findMany: findManyStore }, syncRun: { findFirst: vi.fn() } } }));
    vi.doMock("@/lib/sync/pipeline", () => ({ syncCatalog: vi.fn(), syncJudgeme: vi.fn() }));
    const { GET } = await import("@/app/api/cron/sync/route");
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    expect(findManyStore).not.toHaveBeenCalled();
  });

  it("saute une boutique dont la dernière synchro est encore 'running' (< 15 min)", async () => {
    process.env.CRON_SECRET = "s";
    vi.resetModules();
    const syncCatalog = vi.fn();
    const syncJudgeme = vi.fn();
    vi.doMock("@/lib/db", () => ({
      prisma: {
        store: { findMany: vi.fn().mockResolvedValue([{ id: "store1", name: "Boutique 1" }]) },
        syncRun: { findFirst: vi.fn().mockResolvedValue({ id: "run1" }) },
      },
    }));
    vi.doMock("@/lib/sync/pipeline", () => ({ syncCatalog, syncJudgeme }));
    const { GET } = await import("@/app/api/cron/sync/route");
    const res = await GET(makeRequest({ authorization: "Bearer s" }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.skipped).toBe(1);
    expect(body.processed).toBe(0);
    expect(syncCatalog).not.toHaveBeenCalled();
    expect(syncJudgeme).not.toHaveBeenCalled();
  });

  it("synchronise catalogue + judgeme pour chaque boutique éligible, via syncCatalog (pas syncShopify)", async () => {
    process.env.CRON_SECRET = "s";
    vi.resetModules();
    const syncCatalog = vi.fn().mockResolvedValue({ status: "success", itemsFetched: 10, itemsStored: 10, errorCount: 0, provider: "WOOCOMMERCE" });
    const syncJudgeme = vi.fn().mockResolvedValue({ status: "success" });
    vi.doMock("@/lib/db", () => ({
      prisma: {
        store: { findMany: vi.fn().mockResolvedValue([{ id: "store1", name: "Boutique 1" }]) },
        syncRun: { findFirst: vi.fn().mockResolvedValue(null) },
      },
    }));
    vi.doMock("@/lib/sync/pipeline", () => ({ syncCatalog, syncJudgeme }));
    const { GET } = await import("@/app/api/cron/sync/route");
    const res = await GET(makeRequest({ authorization: "Bearer s" }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.processed).toBe(1);
    expect(body.results[0]).toMatchObject({ storeId: "store1", catalog: "success", judgeme: "success" });
    expect(syncCatalog).toHaveBeenCalledWith("store1", "scheduled");
    expect(syncJudgeme).toHaveBeenCalledWith("store1", "scheduled");
  });

  it("continue avec les boutiques suivantes après une erreur inattendue sur l'une d'elles", async () => {
    process.env.CRON_SECRET = "s";
    vi.resetModules();
    const syncCatalog = vi.fn().mockImplementation(async (storeId: string) => {
      if (storeId === "store1") throw new Error("panne réseau");
      return { status: "success", itemsFetched: 1, itemsStored: 1, errorCount: 0, provider: "SHOPIFY" };
    });
    const syncJudgeme = vi.fn().mockResolvedValue({ status: "not_connected" });
    vi.doMock("@/lib/db", () => ({
      prisma: {
        store: {
          findMany: vi.fn().mockResolvedValue([
            { id: "store1", name: "Boutique 1" },
            { id: "store2", name: "Boutique 2" },
          ]),
        },
        syncRun: { findFirst: vi.fn().mockResolvedValue(null) },
      },
    }));
    vi.doMock("@/lib/sync/pipeline", () => ({ syncCatalog, syncJudgeme }));
    const { GET } = await import("@/app/api/cron/sync/route");
    const res = await GET(makeRequest({ authorization: "Bearer s" }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.processed).toBe(2);
    expect(body.results[0]).toMatchObject({ storeId: "store1", catalog: "error", judgeme: "error" });
    expect(body.results[1]).toMatchObject({ storeId: "store2", catalog: "success" });
  });
});
