import { describe, it, expect, afterEach, vi } from "vitest";
import { updateVariantStock, ShopifyApiError, type ShopifyCredentials } from "@/lib/integrations/shopify";

// updateVariantStock (05/09/2026) — écrit une quantité de stock ABSOLUE sur
// Shopify pour une variante donnée. Deux appels réseau : (1) résout
// inventoryItem + location EN DIRECT (jamais mis en cache côté OnDeal),
// (2) inventorySetQuantities. Ces tests verrouillent les deux étapes et le
// cas où aucun niveau d'inventaire n'est trouvé (suivi désactivé).

const REAL_FETCH = global.fetch;
const CREDS: ShopifyCredentials = { domain: "ma-boutique.myshopify.com", accessToken: "shpat_test" };
const VARIANT_GID = "gid://shopify/ProductVariant/1";

function mockGraphqlSequence(bodies: Array<Record<string, unknown>>) {
  let call = 0;
  const calls: Array<Record<string, unknown>> = [];
  global.fetch = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
    calls.push(JSON.parse(init.body as string));
    const body = bodies[Math.min(call, bodies.length - 1)]!;
    call += 1;
    return { ok: true, status: 200, json: async () => body };
  }) as unknown as typeof fetch;
  return calls;
}

afterEach(() => {
  global.fetch = REAL_FETCH;
  vi.restoreAllMocks();
});

describe("updateVariantStock", () => {
  it("résout inventoryItem + location puis écrit la quantité absolue via inventorySetQuantities", async () => {
    const calls = mockGraphqlSequence([
      {
        data: {
          productVariant: {
            inventoryItem: { id: "gid://shopify/InventoryItem/1", inventoryLevels: { nodes: [{ location: { id: "gid://shopify/Location/1" } }] } },
          },
        },
      },
      {
        data: {
          inventorySetQuantities: {
            inventoryAdjustmentGroup: { changes: [{ name: "available", delta: -4, quantityAfterChange: 8 }] },
            userErrors: [],
          },
        },
      },
    ]);

    const result = await updateVariantStock(CREDS, VARIANT_GID, 8);
    expect(result).toEqual({ ok: true, quantity: 8 });

    // Premier appel : requête de résolution, avec l'id de variante.
    expect(calls[0]!.variables).toEqual({ id: VARIANT_GID });
    // Second appel : mutation avec la quantité ABSOLUE demandée, ignoreCompareQuantity activé
    // (la fraîcheur est déjà vérifiée en amont par le snapshot de simulation, pas ici).
    const mutationInput = (calls[1]!.variables as { input: Record<string, unknown> }).input;
    expect(mutationInput).toMatchObject({
      name: "available",
      reason: "correction",
      ignoreCompareQuantity: true,
      quantities: [{ inventoryItemId: "gid://shopify/InventoryItem/1", locationId: "gid://shopify/Location/1", quantity: 8 }],
    });
  });

  it("retourne ok:false si aucun niveau d'inventaire n'est trouvé (suivi de stock désactivé) — jamais une écriture à l'aveugle", async () => {
    mockGraphqlSequence([{ data: { productVariant: { inventoryItem: { id: "gid://shopify/InventoryItem/1", inventoryLevels: { nodes: [] } } } } }]);
    const result = await updateVariantStock(CREDS, VARIANT_GID, 8);
    expect(result).toEqual({ ok: false, error: expect.stringContaining("Aucun emplacement") });
  });

  it("retourne ok:false si Shopify renvoie des userErrors sur la mutation", async () => {
    mockGraphqlSequence([
      {
        data: {
          productVariant: {
            inventoryItem: { id: "gid://shopify/InventoryItem/1", inventoryLevels: { nodes: [{ location: { id: "gid://shopify/Location/1" } }] } },
          },
        },
      },
      { data: { inventorySetQuantities: { inventoryAdjustmentGroup: null, userErrors: [{ field: ["quantities"], message: "Quantity must be non-negative" }] } } },
    ]);
    const result = await updateVariantStock(CREDS, VARIANT_GID, -1);
    expect(result).toEqual({ ok: false, error: "Quantity must be non-negative" });
  });

  it("lève ShopifyApiError si le statut HTTP n'est pas ok", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }) as unknown as typeof fetch;
    await expect(updateVariantStock(CREDS, VARIANT_GID, 8)).rejects.toBeInstanceOf(ShopifyApiError);
  });
});
