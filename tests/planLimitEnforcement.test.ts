import { afterEach, describe, expect, it, vi } from "vitest";
import type { ShopifyProductNode } from "@/lib/integrations/shopify";

/**
 * ONDEAL AI CORE — FINAL PHASE : Merchant Plane entitlements réels (06/09/2026).
 *
 * PlanLimit.maxProducts était modélisé (schema.prisma) et AFFICHÉ (Settings,
 * AppShell) depuis PHASE 22, mais jamais réellement APPLIQUÉ au moment de
 * l'écriture — un dépassement de plan ne changeait concrètement rien au
 * comportement de synchronisation. Ce test verrouille l'application réelle
 * dans storeProducts() (src/lib/sync/shopifyStore.ts), partagée par la
 * synchro live Shopify, l'import bulk, et les connecteurs WooCommerce/
 * PrestaShop (voir pipeline.ts) : une seule fonction, un seul point
 * d'application, jamais dupliqué par connecteur.
 */

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

function product(id: string, title = "Produit"): ShopifyProductNode {
  return {
    id,
    handle: `handle-${id}`,
    title,
    status: "ACTIVE",
    productType: null,
    vendor: null,
    createdAt: "2026-01-01T00:00:00Z",
    featuredImage: null,
    variants: { nodes: [] }, // hors périmètre de ce test : seul le blocage au niveau PRODUIT est vérifié ici
  };
}

interface MockOpts {
  plan?: string;
  maxProducts?: number | null; // null = pas de ligne PlanLimit du tout (repli : jamais de blocage)
  existingShopifyProductIds?: string[];
}

async function loadStoreProducts(opts: MockOpts) {
  vi.resetModules();
  const upsertCalls: string[] = [];
  const productUpsert = vi.fn().mockImplementation(({ create }: { create: { shopifyProductId: string } }) => {
    upsertCalls.push(create.shopifyProductId);
    return Promise.resolve({ id: `db-${create.shopifyProductId}` });
  });
  const planLimitFindUnique =
    opts.maxProducts === null
      ? vi.fn().mockResolvedValue(null)
      : vi.fn().mockResolvedValue({ plan: opts.plan ?? "STARTER", maxProducts: opts.maxProducts ?? 3, maxStores: 1, maxUsers: 1 });

  vi.doMock("@/lib/db", () => ({
    prisma: {
      store: { findUnique: vi.fn().mockResolvedValue({ organization: { plan: opts.plan ?? "STARTER" } }) },
      product: {
        findMany: vi.fn().mockResolvedValue((opts.existingShopifyProductIds ?? []).map((shopifyProductId) => ({ shopifyProductId }))),
        upsert: productUpsert,
      },
      planLimit: { findUnique: planLimitFindUnique },
      $transaction: vi.fn().mockImplementation(async (ops: Promise<unknown>[]) => Promise.all(ops)),
    },
  }));

  const mod = await import("@/lib/sync/shopifyStore");
  return { storeProducts: mod.storeProducts, upsertCalls };
}

describe("storeProducts — entitlement réel PlanLimit.maxProducts", () => {
  it("bloque la CRÉATION de nouveaux produits au-delà du quota du plan, sans upsert Prisma pour eux", async () => {
    const { storeProducts, upsertCalls } = await loadStoreProducts({ maxProducts: 2, existingShopifyProductIds: [] });
    const incoming = [product("p1"), product("p2"), product("p3"), product("p4")];
    const stats = await storeProducts("store1", "EUR", incoming, []);

    expect(stats.productsStored).toBe(2);
    expect(stats.productsBlockedByPlanLimit).toBe(2);
    expect(upsertCalls).toEqual(["p1", "p2"]); // seuls les 2 premiers tiennent dans le quota — jamais un upsert au-delà
  });

  it("ne bloque JAMAIS la mise à jour d'un produit déjà synchronisé, même quota déjà atteint", async () => {
    // Quota = 1, déjà 1 produit existant ("p1") -> quota restant = 0 pour les
    // NOUVEAUX produits, mais "p1" doit continuer d'être mis à jour normalement.
    const { storeProducts, upsertCalls } = await loadStoreProducts({ maxProducts: 1, existingShopifyProductIds: ["p1"] });
    const incoming = [product("p1", "Titre mis à jour"), product("p2")];
    const stats = await storeProducts("store1", "EUR", incoming, []);

    expect(upsertCalls).toEqual(["p1"]); // p1 mis à jour ; p2 (nouveau, hors quota) jamais tenté
    expect(stats.productsStored).toBe(1);
    expect(stats.productsBlockedByPlanLimit).toBe(1);
  });

  it("n'applique aucun blocage quand aucune ligne PlanLimit n'existe pour le plan (repli sûr, jamais un blocage par défaut)", async () => {
    const { storeProducts, upsertCalls } = await loadStoreProducts({ maxProducts: null, existingShopifyProductIds: [] });
    const incoming = [product("p1"), product("p2"), product("p3")];
    const stats = await storeProducts("store1", "EUR", incoming, []);

    expect(upsertCalls).toEqual(["p1", "p2", "p3"]);
    expect(stats.productsBlockedByPlanLimit).toBe(0);
  });

  it("consomme le quota au fil du lot (2 nouveaux autorisés sur un quota de 2, le 3e refusé) et le journalise comme 'plan_limit_exceeded'", async () => {
    const { storeProducts } = await loadStoreProducts({ maxProducts: 2, existingShopifyProductIds: [] });
    const issues: import("@/lib/validation/normalize").NormalizeIssue[] = [];
    const stats = await storeProducts("store1", "EUR", [product("p1"), product("p2"), product("p3")], issues);

    expect(stats.issueCountsByProblem.plan_limit_exceeded).toBe(1);
    expect(issues.some((i) => i.problem === "plan_limit_exceeded" && i.original === "p3")).toBe(true);
  });
});
