import { describe, it, expect, afterEach, vi } from "vitest";
import { verifyCjCredentials, queryCjVariantStock, CjApiError, type CjCredentials } from "@/lib/integrations/cjdropshipping";

// CONNECTEUR CJDROPSHIPPING (05/09/2026). Comme pour WooCommerce, ce
// connecteur n'a pu être construit qu'à partir de la documentation
// officielle (developers.cjdropshipping.com/.cn) — pas de vraie clé API
// disponible pour vérifier en direct au moment de l'écriture. Ces tests
// verrouillent le mapping et la gestion d'erreurs contre la forme de
// réponse documentée.

const REAL_FETCH = global.fetch;
const CREDS: CjCredentials = { apiKey: "CJ5test000000000000000000000032" };

function mockFetchSequence(responses: Array<{ status: number; body: unknown }>) {
  let call = 0;
  global.fetch = vi.fn().mockImplementation(async () => {
    const r = responses[Math.min(call, responses.length - 1)]!;
    call += 1;
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body };
  }) as unknown as typeof fetch;
}

afterEach(() => {
  global.fetch = REAL_FETCH;
  vi.restoreAllMocks();
});

describe("apiRequest — en-tête d'authentification et enveloppe de réponse", () => {
  it("envoie l'en-tête CJ-Access-Token avec la clé fournie", async () => {
    mockFetchSequence([{ status: 200, body: { code: 200, result: true, data: {} } }]);
    await verifyCjCredentials(CREDS);
    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const headers = call[1].headers as Record<string, string>;
    expect(headers["CJ-Access-Token"]).toBe(CREDS.apiKey);
  });

  it("lève CjApiError si result: false dans l'enveloppe (clé refusée), sans réessayer inutilement", async () => {
    mockFetchSequence([{ status: 200, body: { code: 1600200, result: false, message: "Clé invalide." } }]);
    await expect(verifyCjCredentials(CREDS)).rejects.toThrow(/Clé invalide/);
  });

  it("lève CjApiError si le statut HTTP n'est pas ok", async () => {
    mockFetchSequence([{ status: 401, body: {} }]);
    await expect(verifyCjCredentials(CREDS)).rejects.toBeInstanceOf(CjApiError);
  });

  it("réessaie sur 429 (limite de débit) avant de réussir", async () => {
    mockFetchSequence([
      { status: 429, body: {} },
      { status: 200, body: { code: 200, result: true, data: {} } },
    ]);
    await verifyCjCredentials(CREDS);
    expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });
});

describe("queryCjVariantStock — mapping du stock réel", () => {
  it("additionne cjInventory/factoryInventory sur tous les entrepôts renvoyés pour le SKU exact", async () => {
    mockFetchSequence([
      {
        status: 200,
        body: {
          code: 200,
          result: true,
          data: {
            pid: "P123",
            productNameEn: "Test product",
            variants: [
              {
                vid: "V1",
                variantSku: "CJXFZNZN00277-Blue LBS foreign language",
                inventories: [
                  { countryCode: "CN", totalInventory: 12, cjInventory: 10, factoryInventory: 2, verifiedWarehouse: 1 },
                  { countryCode: "US", totalInventory: 5, cjInventory: 5, factoryInventory: 0, verifiedWarehouse: 1 },
                ],
              },
              { vid: "V2", variantSku: "CJXFZNZN00277-Purple LBS foreign language", inventories: [] },
            ],
          },
        },
      },
    ]);

    const result = await queryCjVariantStock(CREDS, "CJXFZNZN00277-Blue LBS foreign language");
    expect(result).toEqual({ variantSku: "CJXFZNZN00277-Blue LBS foreign language", cjInventory: 15, factoryInventory: 2 });
  });

  it("retourne null si le SKU n'est pas trouvé parmi les variantes renvoyées — jamais une valeur inventée", async () => {
    mockFetchSequence([
      { status: 200, body: { code: 200, result: true, data: { pid: "P1", productNameEn: "X", variants: [] } } },
    ]);
    const result = await queryCjVariantStock(CREDS, "SKU-INCONNU");
    expect(result).toBeNull();
  });

  it("retourne null si la variante trouvée n'a aucune donnée d'inventaire", async () => {
    mockFetchSequence([
      {
        status: 200,
        body: {
          code: 200,
          result: true,
          data: { pid: "P1", productNameEn: "X", variants: [{ vid: "V1", variantSku: "SKU-A" }] },
        },
      },
    ]);
    const result = await queryCjVariantStock(CREDS, "SKU-A");
    expect(result).toBeNull();
  });
});
