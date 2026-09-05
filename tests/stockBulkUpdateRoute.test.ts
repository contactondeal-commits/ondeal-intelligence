import { describe, it, expect, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

// POST /api/stock/bulk-update (05/09/2026, lot 4) — modification de stock EN
// MASSE (valeur arbitraire, pas liée aux ruptures) : sélection manuelle
// ("selected", plafond 50) ou "toutes les variantes du filtre actuel"
// ("filtered", par lots de 50, même pipeline analyzeStock/queryStock que la
// page /stock). Ces tests verrouillent : la validation des paramètres, le
// garde-fou d'authentification, le calcul de la nouvelle quantité (absolue
// vs ajustement relatif, jamais négative, jamais devinée si le stock actuel
// est inconnu), la réutilisation SANS DUPLICATION de /api/stock/update pour
// chaque variante, et la pagination du mode "filtered" (nextOffset).

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/stock/bulk-update", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

type Variant = { id: string; productId: string; title: string; sku: string | null; inventoryQuantity: number | null; supplierStock: number | null; updatedAt: Date };
type Product = { id: string; title: string; productType: string | null; _count: { variants: number } };

async function loadWithMocks(opts: {
  requireStoreAccess?: ReturnType<typeof vi.fn>;
  /** Message d'une AuthError à faire rejeter par requireStoreAccess — construite DANS le factory vi.doMock avec le MÊME `actual` que route.ts importera (sinon instanceof échoue après vi.resetModules()). */
  requireStoreAccessAuthError?: string;
  updateSingleStock?: ReturnType<typeof vi.fn>;
  variantsForSelected?: Array<{ id: string; title: string; product: { title: string } }>;
  products?: Product[];
  variants?: Variant[];
  logAudit?: ReturnType<typeof vi.fn>;
}) {
  vi.resetModules();

  vi.doMock("@/lib/auth", async () => {
    const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
    const requireStoreAccess = opts.requireStoreAccessAuthError
      ? vi.fn().mockRejectedValue(new actual.AuthError(opts.requireStoreAccessAuthError))
      : (opts.requireStoreAccess ?? vi.fn().mockResolvedValue({ userId: "user1", role: "OWNER" }));
    return { ...actual, requireStoreAccess };
  });

  const variantsForSelected = opts.variantsForSelected ?? [{ id: "v1", title: "Rouge", product: { title: "T-shirt" } }];
  const products = opts.products ?? [];
  const variants = opts.variants ?? [];

  // La route interroge prisma.variant.findMany sous deux formes différentes
  // selon le mode : "selected" filtre par { id: { in: [...] } } (variantes
  // cochées), "filtered" ne filtre que par produit (tout le catalogue, pour
  // reproduire exactement le pipeline de la page /stock).
  vi.doMock("@/lib/db", () => ({
    prisma: {
      variant: {
        findMany: vi.fn().mockImplementation(async (args: { where: Record<string, unknown> }) => {
          if (args.where && "id" in args.where) {
            const ids = (args.where.id as { in: string[] }).in;
            return variantsForSelected.filter((v) => ids.includes(v.id));
          }
          return variants;
        }),
      },
      product: { findMany: vi.fn().mockResolvedValue(products) },
      salesSnapshot: { groupBy: vi.fn().mockResolvedValue([]) },
    },
  }));

  const logAudit = opts.logAudit ?? vi.fn().mockResolvedValue(undefined);
  vi.doMock("@/lib/audit", () => ({ logAudit }));

  const updateSingleStock =
    opts.updateSingleStock ??
    vi.fn().mockImplementation(async (req: NextRequest) => {
      const body = await req.json();
      return new Response(JSON.stringify({ ok: true, kind: "automated_mutation", detail: `Stock mis à jour : ${body.newQuantity}.` }), { status: 200 });
    });
  vi.doMock("@/app/api/stock/update/route", () => ({ POST: updateSingleStock }));

  const { POST } = await import("@/app/api/stock/bulk-update/route");
  return { POST, updateSingleStock, logAudit };
}

describe("POST /api/stock/bulk-update", () => {
  it("refuse des paramètres invalides (storeId/rule/mode manquants)", async () => {
    const { POST } = await loadWithMocks({});
    const res = await POST(makeRequest({ storeId: "store1" }));
    expect(res.status).toBe(400);
  });

  it("refuse une règle absolue négative (validation stricte)", async () => {
    const { POST } = await loadWithMocks({});
    const res = await POST(makeRequest({ storeId: "store1", mode: "selected", rule: { kind: "absolute", value: -5 }, items: [{ variantId: "v1", expectedCurrentQuantity: 10 }] }));
    expect(res.status).toBe(400);
  });

  it("propage une AuthError en 403", async () => {
    const { POST } = await loadWithMocks({ requireStoreAccessAuthError: "Accès refusé." });
    const res = await POST(makeRequest({ storeId: "store1", mode: "selected", rule: { kind: "absolute", value: 10 }, items: [{ variantId: "v1", expectedCurrentQuantity: 5 }] }));
    expect(res.status).toBe(403);
  });

  it("mode selected : refuse une sélection vide", async () => {
    const { POST } = await loadWithMocks({});
    const res = await POST(makeRequest({ storeId: "store1", mode: "selected", rule: { kind: "absolute", value: 10 }, items: [] }));
    expect(res.status).toBe(400);
  });

  it("mode selected : refuse plus de 50 variantes (plafond de sécurité)", async () => {
    const { POST } = await loadWithMocks({});
    const items = Array.from({ length: 51 }, (_, i) => ({ variantId: `v${i}`, expectedCurrentQuantity: 0 }));
    const res = await POST(makeRequest({ storeId: "store1", mode: "selected", rule: { kind: "absolute", value: 10 }, items }));
    expect(res.status).toBe(400);
  });

  it("mode selected : chemin heureux, applique la règle absolue à chaque variante via /api/stock/update (sans dupliquer sa logique)", async () => {
    const { POST, updateSingleStock } = await loadWithMocks({
      variantsForSelected: [
        { id: "v1", title: "Rouge", product: { title: "T-shirt" } },
        { id: "v2", title: "Bleu", product: { title: "T-shirt" } },
      ],
    });
    const res = await POST(
      makeRequest({
        storeId: "store1",
        mode: "selected",
        rule: { kind: "absolute", value: 25 },
        items: [
          { variantId: "v1", expectedCurrentQuantity: 3 },
          { variantId: "v2", expectedCurrentQuantity: 0 },
        ],
      }),
    );
    const body = await res.json();
    expect(body.applied).toHaveLength(2);
    expect(body.applied.every((a: { newQuantity: number }) => a.newQuantity === 25)).toBe(true);
    expect(updateSingleStock).toHaveBeenCalledTimes(2);
  });

  it("règle delta : ajuste relativement au stock actuel, jamais en dessous de 0", async () => {
    const { POST } = await loadWithMocks({
      variantsForSelected: [{ id: "v1", title: "Rouge", product: { title: "T-shirt" } }],
    });
    const res = await POST(
      makeRequest({
        storeId: "store1",
        mode: "selected",
        rule: { kind: "delta", value: -100 },
        items: [{ variantId: "v1", expectedCurrentQuantity: 5 }],
      }),
    );
    const body = await res.json();
    expect(body.applied[0].newQuantity).toBe(0);
  });

  it("règle delta : ignore (sans appeler /api/stock/update) une variante dont le stock actuel est inconnu, plutôt que de deviner", async () => {
    const { POST, updateSingleStock } = await loadWithMocks({
      variantsForSelected: [{ id: "v1", title: "Rouge", product: { title: "T-shirt" } }],
    });
    const res = await POST(
      makeRequest({
        storeId: "store1",
        mode: "selected",
        rule: { kind: "delta", value: 10 },
        items: [{ variantId: "v1", expectedCurrentQuantity: null }],
      }),
    );
    const body = await res.json();
    expect(body.applied).toEqual([]);
    expect(body.skipped).toHaveLength(1);
    expect(updateSingleStock).not.toHaveBeenCalled();
  });

  it("consigne comme ignorée une variante dont la mise à jour individuelle échoue", async () => {
    const updateSingleStock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Le stock affiché a changé." }), { status: 409 }));
    const { POST } = await loadWithMocks({ updateSingleStock, variantsForSelected: [{ id: "v1", title: "Rouge", product: { title: "T-shirt" } }] });
    const res = await POST(makeRequest({ storeId: "store1", mode: "selected", rule: { kind: "absolute", value: 10 }, items: [{ variantId: "v1", expectedCurrentQuantity: 3 }] }));
    const body = await res.json();
    expect(body.applied).toEqual([]);
    expect(body.skipped[0].reason).toBe("Le stock affiché a changé.");
  });

  it("mode filtered : applique la règle à toutes les variantes correspondant au filtre (même pipeline que la page /stock), par lot avec nextOffset", async () => {
    const products: Product[] = [
      { id: "p1", title: "Montre A", productType: "Montres", _count: { variants: 1 } },
      { id: "p2", title: "Montre B", productType: "Montres", _count: { variants: 1 } },
      { id: "p3", title: "Chaussure", productType: "Chaussures", _count: { variants: 1 } },
    ];
    const variants: Variant[] = [
      { id: "v1", productId: "p1", title: "Unique", sku: "SKU1", inventoryQuantity: 0, supplierStock: null, updatedAt: new Date() },
      { id: "v2", productId: "p2", title: "Unique", sku: "SKU2", inventoryQuantity: 0, supplierStock: null, updatedAt: new Date() },
      { id: "v3", productId: "p3", title: "Unique", sku: "SKU3", inventoryQuantity: 0, supplierStock: null, updatedAt: new Date() },
    ];
    const { POST, updateSingleStock } = await loadWithMocks({ products, variants });
    const res = await POST(
      makeRequest({
        storeId: "store1",
        mode: "filtered",
        rule: { kind: "absolute", value: 100 },
        filters: { status: "all", category: "Montres", sort: "title" },
        offset: 0,
      }),
    );
    const body = await res.json();
    // seules les 2 variantes "Montres" doivent correspondre (filtre catégorie), pas "Chaussures".
    expect(body.totalMatching).toBe(2);
    expect(body.applied).toHaveLength(2);
    expect(body.nextOffset).toBeNull();
    expect(updateSingleStock).toHaveBeenCalledTimes(2);
  });
});
