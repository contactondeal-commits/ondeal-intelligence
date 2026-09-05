import { describe, it, expect, afterEach, vi } from "vitest";

// executeReviewSupplier / checkCjStock (05/09/2026 v2) — au clic "Vérifier
// le fournisseur", si CJdropshipping confirme un stock réel pour une
// variante affichée en VRAIE rupture (inventoryQuantity === 0) sur Shopify,
// OnDeal corrige maintenant aussi réellement ce stock sur Shopify (et pas
// seulement Variant.supplierStock, comme avant ce correctif). Ces tests
// verrouillent : le cas heureux (correction appliquée + persistée), le
// garde-fou "jamais si le stock affiché n'est pas 0" (jamais de diminution
// silencieuse d'un stock existant), le comportement best-effort si Shopify
// n'est pas connecté ou si la mutation échoue, et le fait qu'une rupture
// confirmée réelle (CJ aussi à 0) ne déclenche jamais de mutation.

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

async function loadWithMocks(opts: {
  variants?: Array<Record<string, unknown>>;
  cjIntegration?: Record<string, unknown> | null;
  shopifyIntegration?: Record<string, unknown> | null;
  queryCjVariantStock?: ReturnType<typeof vi.fn>;
  updateVariantStock?: ReturnType<typeof vi.fn>;
  variantUpdate?: ReturnType<typeof vi.fn>;
}) {
  vi.resetModules();

  const variantUpdate = opts.variantUpdate ?? vi.fn().mockResolvedValue({});
  const variantFindMany = vi.fn().mockResolvedValue(
    opts.variants ?? [{ id: "v1", sku: "SKU-1", title: "T-shirt bleu", inventoryQuantity: 0, shopifyVariantId: "gid://shopify/ProductVariant/1" }],
  );
  const integrationFindUnique = vi.fn().mockImplementation(async ({ where }: { where: { storeId_provider: { provider: string } } }) => {
    const provider = where.storeId_provider.provider;
    if (provider === "CJDROPSHIPPING") {
      return opts.cjIntegration === undefined ? { status: "CONNECTED", encryptedCredentials: "enc" } : opts.cjIntegration;
    }
    if (provider === "SHOPIFY") {
      return opts.shopifyIntegration === undefined ? { status: "CONNECTED", encryptedCredentials: "enc" } : opts.shopifyIntegration;
    }
    return null;
  });

  vi.doMock("@/lib/db", () => ({
    prisma: {
      variant: { findMany: variantFindMany, update: variantUpdate },
      integration: { findUnique: integrationFindUnique },
    },
  }));

  vi.doMock("@/lib/integrations/cjdropshipping-token", () => ({
    getFreshCjCredentials: vi.fn().mockResolvedValue({ apiKey: "k", accessToken: "cj-token" }),
  }));
  vi.doMock("@/lib/integrations/shopify-token", () => ({
    getFreshShopifyCredentials: vi.fn().mockResolvedValue({ domain: "ma-boutique.myshopify.com", accessToken: "shpat_test" }),
  }));

  const queryCjVariantStock = opts.queryCjVariantStock ?? vi.fn().mockResolvedValue({ variantSku: "SKU-1", cjInventory: 12, factoryInventory: 0 });
  vi.doMock("@/lib/integrations/cjdropshipping", () => ({ queryCjVariantStock, CjApiError: class extends Error {} }));

  const updateVariantStock = opts.updateVariantStock ?? vi.fn().mockResolvedValue({ ok: true, quantity: 12 });
  vi.doMock("@/lib/integrations/shopify", () => ({ updateVariantStock, updateVariantPrice: vi.fn(), updateProductStatus: vi.fn() }));

  const { executeReviewSupplier } = await import("@/app/api/actions/[id]/execute/route");
  return { executeReviewSupplier, variantUpdate, queryCjVariantStock, updateVariantStock };
}

const PAYLOAD = { variantId: "v1" };

describe("executeReviewSupplier — correction Shopify au clic 'Vérifier le fournisseur'", () => {
  it("corrige réellement le stock Shopify quand CJ confirme un stock réel pour une VRAIE rupture (inventoryQuantity 0)", async () => {
    const { executeReviewSupplier, variantUpdate, updateVariantStock } = await loadWithMocks({});
    const result = await executeReviewSupplier("store1", PAYLOAD);

    expect(result.ok).toBe(true);
    expect(updateVariantStock).toHaveBeenCalledWith(expect.objectContaining({ domain: "ma-boutique.myshopify.com" }), "gid://shopify/ProductVariant/1", 12);
    // Persisté en base : supplierStock (toujours) ET inventoryQuantity (nouveau).
    const calls = variantUpdate.mock.calls.map((c) => c[0]);
    expect(calls).toContainEqual({ where: { id: "v1" }, data: { supplierStock: 12 } });
    expect(calls).toContainEqual({ where: { id: "v1" }, data: { inventoryQuantity: 12 } });
    expect(result.ok && result.detail).toContain("corrigé automatiquement sur Shopify");
  });

  it("ne corrige JAMAIS Shopify si le stock affiché n'est pas une vraie rupture (inventoryQuantity != 0) — jamais de diminution silencieuse", async () => {
    const { executeReviewSupplier, variantUpdate, updateVariantStock } = await loadWithMocks({
      variants: [{ id: "v1", sku: "SKU-1", title: "T-shirt bleu", inventoryQuantity: 5, shopifyVariantId: "gid://shopify/ProductVariant/1" }],
    });
    const result = await executeReviewSupplier("store1", PAYLOAD);

    expect(result.ok).toBe(true);
    expect(updateVariantStock).not.toHaveBeenCalled();
    expect(variantUpdate.mock.calls.map((c) => c[0])).not.toContainEqual(expect.objectContaining({ data: { inventoryQuantity: 12 } }));
    expect(result.ok && result.detail).toContain("pas encore synchronisé sur Shopify");
  });

  it("dégrade proprement si Shopify n'est pas connecté — rafraîchit quand même supplierStock, jamais bloquant", async () => {
    const { executeReviewSupplier, updateVariantStock } = await loadWithMocks({ shopifyIntegration: null });
    const result = await executeReviewSupplier("store1", PAYLOAD);

    expect(result.ok).toBe(true);
    expect(updateVariantStock).not.toHaveBeenCalled();
    expect(result.ok && result.detail).toContain("pas encore synchronisé sur Shopify");
  });

  it("signale l'échec de correction sans faire échouer la mission si la mutation Shopify échoue", async () => {
    const updateVariantStock = vi.fn().mockResolvedValue({ ok: false, error: "Aucun emplacement d'inventaire Shopify trouvé." });
    const { executeReviewSupplier } = await loadWithMocks({ updateVariantStock });
    const result = await executeReviewSupplier("store1", PAYLOAD);

    expect(result.ok).toBe(true);
    expect(result.ok && result.detail).toContain("la correction Shopify a échoué");
  });

  it("ne tente aucune correction quand CJ confirme aussi une rupture réelle (0 unité)", async () => {
    const queryCjVariantStock = vi.fn().mockResolvedValue({ variantSku: "SKU-1", cjInventory: 0, factoryInventory: 0 });
    const { executeReviewSupplier, updateVariantStock } = await loadWithMocks({ queryCjVariantStock });
    const result = await executeReviewSupplier("store1", PAYLOAD);

    expect(result.ok).toBe(true);
    expect(updateVariantStock).not.toHaveBeenCalled();
    expect(result.ok && result.detail).toContain("rupture confirmée réellement");
  });
});
