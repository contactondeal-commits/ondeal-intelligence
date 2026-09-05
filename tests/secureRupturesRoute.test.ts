import { describe, it, expect, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

// POST /api/stock/secure-ruptures (05/09/2026 v3) — version EN MASSE de
// "Vérifier le fournisseur" : par lot, vérifie chaque rupture auprès de CJ
// (corrige Shopify si le fournisseur a réellement du stock), puis dépublie
// IMMÉDIATEMENT tout produit actif confirmé sans AUCUN stock nulle part
// (boutique ET fournisseur). Ces tests verrouillent : le garde-fou Shopify
// requis, l'absence de traitement si aucune rupture, le refus de dépublier
// sans vérification CJ réussie, le chemin heureux (correction + dépublication),
// le garde-fou "jamais si une variante n'est pas confirmée par le fournisseur"
// et l'anti-doublon de dépublication.

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/stock/secure-ruptures", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

type Variant = { id: string; sku: string | null; productId: string; title: string; inventoryQuantity: number | null; supplierStock: number | null };
type Product = { id: string; storeId: string; status: string; title: string; variants: Variant[] };

async function loadWithMocks(opts: {
  requireStoreAccess?: ReturnType<typeof vi.fn>;
  shopifyIntegrationStatus?: string | null;
  rupturedVariants?: Variant[];
  products?: Product[];
  checkCjStock?: ReturnType<typeof vi.fn>;
  executeUnpublish?: ReturnType<typeof vi.fn>;
  existingUnpublishAction?: Record<string, unknown> | null;
}) {
  vi.resetModules();

  vi.doMock("@/lib/auth", async () => {
    const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
    return { ...actual, requireStoreAccess: opts.requireStoreAccess ?? vi.fn().mockResolvedValue({ userId: "user1", role: "OWNER" }) };
  });

  const variants: Variant[] = opts.rupturedVariants ?? [
    { id: "v1", sku: "SKU-1", productId: "p1", title: "T-shirt bleu", inventoryQuantity: 0, supplierStock: null },
  ];
  const products: Product[] = opts.products ?? [
    { id: "p1", storeId: "store1", status: "active", title: "T-shirt", variants: [{ ...variants[0]!, supplierStock: 0 }] },
  ];

  const actionItemCreate = vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: `action-${Math.random().toString(36).slice(2, 8)}`, ...data }));
  const actionItemUpdate = vi.fn().mockResolvedValue({});
  const actionItemFindMany = vi.fn().mockResolvedValue(opts.existingUnpublishAction ? [opts.existingUnpublishAction] : []);
  const $transaction = vi.fn().mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb({ actionItem: { findMany: actionItemFindMany, create: actionItemCreate } }));

  vi.doMock("@/lib/db", () => ({
    prisma: {
      integration: { findUnique: vi.fn().mockResolvedValue(opts.shopifyIntegrationStatus === undefined ? { status: "CONNECTED" } : opts.shopifyIntegrationStatus === null ? null : { status: opts.shopifyIntegrationStatus }) },
      variant: {
        count: vi.fn().mockResolvedValue(variants.length),
        findMany: vi.fn().mockResolvedValue(variants),
      },
      product: {
        findFirst: vi.fn().mockImplementation(async ({ where }: { where: { id: string; storeId: string } }) => products.find((p) => p.id === where.id && p.storeId === where.storeId) ?? null),
      },
      actionItem: { create: actionItemCreate, update: actionItemUpdate, $transaction },
      $transaction,
    },
  }));

  const logAudit = vi.fn().mockResolvedValue(undefined);
  vi.doMock("@/lib/audit", () => ({ logAudit }));

  const checkCjStock = opts.checkCjStock ?? vi.fn().mockResolvedValue({
    detail: "Vérifié en direct chez CJ : rupture confirmée réellement côté fournisseur pour 1 variante(s).",
    perVariant: [{ variantId: "v1", resolvable: true, supplierConfirmedZero: true, correctedToShopify: false, newQuantity: null, line: "confirmé" }],
  });
  const executeUnpublish = opts.executeUnpublish ?? vi.fn().mockResolvedValue({ ok: true, kind: "automated_mutation", detail: "Produit dépublié (statut Draft) sur Shopify.", verification: "ok", before: "active", applied: "draft", verified: "draft" });
  vi.doMock("@/app/api/actions/[id]/execute/route", () => ({ checkCjStock, executeUnpublish, MAX_CJ_LOOKUPS_PER_EXECUTION: 20 }));

  const { POST } = await import("@/app/api/stock/secure-ruptures/route");
  return { POST, checkCjStock, executeUnpublish, actionItemCreate, actionItemUpdate, logAudit };
}

describe("POST /api/stock/secure-ruptures", () => {
  it("refuse si Shopify n'est pas connecté (409)", async () => {
    const { POST } = await loadWithMocks({ shopifyIntegrationStatus: null });
    const res = await POST(makeRequest({ storeId: "store1" }));
    expect(res.status).toBe(409);
  });

  it("répond proprement sans rien traiter s'il n'y a aucune rupture", async () => {
    const { POST, checkCjStock } = await loadWithMocks({ rupturedVariants: [] });
    const res = await POST(makeRequest({ storeId: "store1" }));
    const body = await res.json();
    expect(body.processed).toBe(0);
    expect(body.totalMatching).toBe(0);
    expect(checkCjStock).not.toHaveBeenCalled();
  });

  it("ne dépublie JAMAIS si CJdropshipping n'est pas connecté — vérifie/corrige seulement quand c'est possible", async () => {
    const checkCjStock = vi.fn().mockResolvedValue(null); // CJ non connecté
    const { POST, executeUnpublish } = await loadWithMocks({ checkCjStock });
    const res = await POST(makeRequest({ storeId: "store1" }));
    const body = await res.json();

    expect(body.cjConnected).toBe(false);
    expect(body.unpublished).toEqual([]);
    expect(executeUnpublish).not.toHaveBeenCalled();
  });

  it("chemin heureux : corrige le stock quand CJ en a, dépublie le produit confirmé sans aucun stock", async () => {
    const checkCjStock = vi.fn().mockResolvedValue({
      detail: "corrigé",
      perVariant: [{ variantId: "v1", resolvable: true, supplierConfirmedZero: true, correctedToShopify: false, newQuantity: null, line: "confirmé" }],
    });
    const { POST, executeUnpublish } = await loadWithMocks({ checkCjStock });
    const res = await POST(makeRequest({ storeId: "store1" }));
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.stillUnavailable).toEqual([{ variantId: "v1", title: "T-shirt bleu" }]);
    expect(body.unpublished).toEqual([{ productId: "p1", title: "T-shirt" }]);
    expect(executeUnpublish).toHaveBeenCalledWith("store1", { productId: "p1" });
  });

  it("ne dépublie JAMAIS un produit dont une variante n'est pas confirmée par le fournisseur (supplierStock null ou > 0)", async () => {
    const variants: Variant[] = [
      { id: "v1", sku: "SKU-1", productId: "p1", title: "Var A", inventoryQuantity: 0, supplierStock: null },
      { id: "v2", sku: "SKU-2", productId: "p1", title: "Var B", inventoryQuantity: 0, supplierStock: null },
    ];
    const products: Product[] = [{ id: "p1", storeId: "store1", status: "active", title: "Produit", variants }];
    const checkCjStock = vi.fn().mockResolvedValue({
      detail: "partiel",
      // Seule v1 confirmée cette fois — v2 reste supplierStock: null (jamais vérifiée) dans "products" ci-dessus.
      perVariant: [{ variantId: "v1", resolvable: true, supplierConfirmedZero: true, correctedToShopify: false, newQuantity: null, line: "confirmé" }],
    });
    const { POST, executeUnpublish } = await loadWithMocks({ rupturedVariants: variants, products, checkCjStock });
    const res = await POST(makeRequest({ storeId: "store1" }));
    const body = await res.json();

    expect(body.unpublished).toEqual([]);
    expect(executeUnpublish).not.toHaveBeenCalled();
  });

  it("anti-doublon : réutilise une dépublication déjà active pour ce produit plutôt que d'en créer une seconde", async () => {
    const { POST, executeUnpublish } = await loadWithMocks({
      existingUnpublishAction: { id: "existing", type: "unpublish_product", payloadJson: JSON.stringify({ productId: "p1" }) },
    });
    const res = await POST(makeRequest({ storeId: "store1" }));
    const body = await res.json();

    expect(body.unpublished).toEqual([]);
    expect(executeUnpublish).not.toHaveBeenCalled();
  });

  it("compte les variantes sans SKU comme non vérifiables, sans bloquer le reste du lot", async () => {
    const variants: Variant[] = [
      { id: "v1", sku: null, productId: "p1", title: "Sans SKU", inventoryQuantity: 0, supplierStock: null },
      { id: "v2", sku: "SKU-2", productId: "p2", title: "Avec SKU", inventoryQuantity: 0, supplierStock: null },
    ];
    const products: Product[] = [
      { id: "p1", storeId: "store1", status: "active", title: "P1", variants: [variants[0]!] },
      { id: "p2", storeId: "store1", status: "active", title: "P2", variants: [{ ...variants[1]!, supplierStock: 0 }] },
    ];
    const checkCjStock = vi.fn().mockResolvedValue({
      detail: "ok",
      perVariant: [{ variantId: "v2", resolvable: true, supplierConfirmedZero: true, correctedToShopify: false, newQuantity: null, line: "confirmé" }],
    });
    const { POST } = await loadWithMocks({ rupturedVariants: variants, products, checkCjStock });
    const res = await POST(makeRequest({ storeId: "store1" }));
    const body = await res.json();

    expect(body.skippedNoSku).toBe(1);
    expect(checkCjStock).toHaveBeenCalledWith("store1", ["v2"]);
  });
});
