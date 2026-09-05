import { describe, it, expect, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

// POST /api/stock/update (05/09/2026) — condense proposer → confirmer →
// exécuter en un seul appel pour une saisie manuelle de stock (voir la
// route pour le raisonnement complet). Ces tests verrouillent les garde-fous
// (Shopify requis, variante hors périmètre, donnée obsolète, anti-doublon)
// et le chemin heureux (ActionItem créée/confirmée/exécutée + audit).

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/stock/update", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

const VALID_BODY = { storeId: "store1", variantId: "v1", newQuantity: 8, expectedCurrentQuantity: 12 };

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

async function loadWithMocks(opts: {
  requireStoreAccess?: ReturnType<typeof vi.fn>;
  /** Message d'une AuthError à faire rejeter par requireStoreAccess — construite avec LA MÊME instance de classe que celle importée par la route (voir note ci-dessous), jamais une classe distincte issue d'un import antérieur au reset des modules. */
  requireStoreAccessAuthError?: string;
  variant?: Record<string, unknown> | null;
  integrationStatus?: string | null;
  transactionResult?: { action: Record<string, unknown>; resumed: boolean };
  actionItemFindMany?: ReturnType<typeof vi.fn>;
  actionItemUpdate?: ReturnType<typeof vi.fn>;
  fetchCurrentStockFields?: ReturnType<typeof vi.fn>;
  executeUpdateStock?: ReturnType<typeof vi.fn>;
  logAudit?: ReturnType<typeof vi.fn>;
}) {
  vi.resetModules();

  vi.doMock("@/lib/auth", async () => {
    const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
    // IMPORTANT : l'AuthError rejetée doit venir de CE `actual` (même epoch de
    // module que celle que route.ts importera) — une instance construite via
    // un `import` antérieur à `vi.resetModules()` échouerait le `instanceof`
    // dans la route (classe distincte après reset du registre de modules).
    const requireStoreAccess = opts.requireStoreAccessAuthError
      ? vi.fn().mockRejectedValue(new actual.AuthError(opts.requireStoreAccessAuthError))
      : (opts.requireStoreAccess ?? vi.fn().mockResolvedValue({ userId: "user1", role: "OWNER" }));
    return { ...actual, requireStoreAccess };
  });

  const actionItemUpdate = opts.actionItemUpdate ?? vi.fn().mockResolvedValue({});
  const actionItemFindMany = opts.actionItemFindMany ?? vi.fn().mockResolvedValue([]);
  const actionItemCreate = vi.fn().mockResolvedValue({ id: "action1" });
  const tx = { actionItem: { findMany: actionItemFindMany, create: actionItemCreate } };
  const $transaction = vi.fn().mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
    if (opts.transactionResult) return opts.transactionResult;
    return cb(tx);
  });

  vi.doMock("@/lib/db", () => ({
    prisma: {
      variant: { findFirst: vi.fn().mockResolvedValue(opts.variant === undefined ? { id: "v1", productId: "p1", title: "T-shirt bleu", inventoryQuantity: 12 } : opts.variant) },
      integration: { findUnique: vi.fn().mockResolvedValue(opts.integrationStatus === undefined ? { status: "CONNECTED" } : opts.integrationStatus === null ? null : { status: opts.integrationStatus }) },
      actionItem: { update: actionItemUpdate },
      $transaction,
    },
  }));

  const logAudit = opts.logAudit ?? vi.fn().mockResolvedValue(undefined);
  vi.doMock("@/lib/audit", () => ({ logAudit }));

  const fetchCurrentStockFields = opts.fetchCurrentStockFields ?? vi.fn().mockResolvedValue({ currentStock: 12, dailyVelocity: 0.5 });
  vi.doMock("@/lib/intelligence/stockEvidence", () => ({ fetchCurrentStockFields }));

  const executeUpdateStock = opts.executeUpdateStock ?? vi.fn().mockResolvedValue({ ok: true, kind: "automated_mutation", detail: "Stock mis à jour sur Shopify : 8 unité(s).", verification: "ok", before: 12, applied: 8, verified: 8 });
  vi.doMock("@/app/api/actions/[id]/execute/route", () => ({ executeUpdateStock }));

  const { POST } = await import("@/app/api/stock/update/route");
  return { POST, actionItemCreate, actionItemFindMany, actionItemUpdate, executeUpdateStock, logAudit };
}

describe("POST /api/stock/update", () => {
  it("refuse un body invalide (400)", async () => {
    const { POST } = await loadWithMocks({});
    const res = await POST(makeRequest({ storeId: "s1" }));
    expect(res.status).toBe(400);
  });

  it("refuse si l'utilisateur n'a pas accès à la boutique (403)", async () => {
    const { POST } = await loadWithMocks({ requireStoreAccessAuthError: "Accès refusé." });
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(403);
  });

  it("refuse si la variante n'existe pas pour cette boutique (404)", async () => {
    const { POST } = await loadWithMocks({ variant: null });
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(404);
  });

  it("refuse si Shopify n'est pas connecté pour cette boutique (409) — jamais pour WooCommerce/PrestaShop", async () => {
    const { POST, executeUpdateStock } = await loadWithMocks({ integrationStatus: null });
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(409);
    expect(executeUpdateStock).not.toHaveBeenCalled();
  });

  it("refuse si le stock affiché ne correspond plus au stock réel (409) — donnée obsolète détectée avant même de créer une ActionItem", async () => {
    const { POST, executeUpdateStock } = await loadWithMocks({ variant: { id: "v1", productId: "p1", title: "T-shirt bleu", inventoryQuantity: 3 } });
    const res = await POST(makeRequest(VALID_BODY)); // expectedCurrentQuantity: 12, réel: 3
    expect(res.status).toBe(409);
    expect(executeUpdateStock).not.toHaveBeenCalled();
  });

  it("réutilise une ActionItem update_stock déjà active pour la même variante plutôt que d'en créer une seconde (anti-doublon)", async () => {
    const { POST, executeUpdateStock } = await loadWithMocks({
      transactionResult: { action: { id: "existing-action", type: "update_stock", payloadJson: JSON.stringify({ variantId: "v1" }) }, resumed: true },
    });
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(409);
    expect(executeUpdateStock).not.toHaveBeenCalled();
  });

  it("chemin heureux : crée puis confirme puis exécute l'ActionItem, journalise chaque étape, renvoie le résultat", async () => {
    const { POST, actionItemUpdate, executeUpdateStock, logAudit } = await loadWithMocks({});
    const res = await POST(makeRequest(VALID_BODY));
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.actionId).toBe("action1");
    expect(executeUpdateStock).toHaveBeenCalledWith("store1", expect.objectContaining({ productId: "p1", variantId: "v1", newQuantity: 8 }));

    // CONFIRMED puis EXECUTED — jamais l'inverse, jamais sauté.
    expect(actionItemUpdate.mock.calls[0]![0]).toMatchObject({ where: { id: "action1" }, data: { status: "CONFIRMED" } });
    expect(actionItemUpdate.mock.calls[1]![0]).toMatchObject({ where: { id: "action1" }, data: { status: "EXECUTED" } });

    const events = logAudit.mock.calls.map((c) => c[0].event);
    expect(events).toEqual(["action.prepared", "action.confirmed", "action.executed"]);
  });

  it("marque l'ActionItem FAILED si l'exécution échoue, sans jamais masquer l'échec", async () => {
    const executeUpdateStock = vi.fn().mockResolvedValue({ ok: false, kind: "error", detail: "Le fournisseur a refusé la mutation." });
    const { POST, actionItemUpdate, logAudit } = await loadWithMocks({ executeUpdateStock });
    const res = await POST(makeRequest(VALID_BODY));
    const body = await res.json();

    expect(body.ok).toBe(false);
    expect(actionItemUpdate.mock.calls[1]![0]).toMatchObject({ data: { status: "FAILED" } });
    const events = logAudit.mock.calls.map((c) => c[0].event);
    expect(events).toEqual(["action.prepared", "action.confirmed", "action.failed"]);
  });
});
