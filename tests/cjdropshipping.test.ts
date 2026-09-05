import { describe, it, expect, afterEach, vi } from "vitest";
import {
  verifyCjCredentials,
  requestCjAccessToken,
  refreshCjAccessToken,
  queryCjVariantStock,
  CjApiError,
  type CjCredentials,
} from "@/lib/integrations/cjdropshipping";

// CONNECTEUR CJDROPSHIPPING (05/09/2026, corrigé le même jour après le
// premier échec de connexion réelle). Comme pour WooCommerce, ce connecteur
// n'a pu être construit qu'à partir de la documentation officielle
// (developers.cjdropshipping.com/en/api/api2/api/auth.html pour l'auth,
// /api2 pour product/list et product/query) — pas de vraie clé API
// disponible pour vérifier en direct au moment de l'écriture. Ces tests
// verrouillent le mapping et la gestion d'erreurs contre la forme de
// réponse documentée.
//
// ⚠️ POINT CENTRAL DE CES TESTS (correctif du 05/09/2026) : la clé API du
// tableau de bord CJ (`apiKey`) n'est JAMAIS envoyée directement comme
// en-tête CJ-Access-Token — elle doit d'abord être échangée contre un
// accessToken via POST /authentication/getAccessToken. La version initiale
// envoyait `apiKey` directement en en-tête, ce que CJ refuse toujours (voir
// commit précédent) : ces tests auraient dû détecter ce bug s'ils avaient
// couvert le flux d'auth réel au lieu de le contourner.

const REAL_FETCH = global.fetch;
const API_KEY = "CJ5test000000000000000000000032";
const ACCESS_TOKEN = "cj-access-token-abc123";
const REFRESH_TOKEN = "cj-refresh-token-def456";

const AUTH_SUCCESS_DATA = {
  openId: 123456789,
  accessToken: ACCESS_TOKEN,
  accessTokenExpiryDate: "2099-01-01T00:00:00+08:00",
  refreshToken: REFRESH_TOKEN,
  refreshTokenExpiryDate: "2099-06-01T00:00:00+08:00",
  createDate: "2099-01-01T00:00:00+08:00",
};

function mockFetchSequence(responses: Array<{ status: number; body: unknown }>) {
  let call = 0;
  const calls: Array<[string, RequestInit | undefined]> = [];
  global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    calls.push([url, init]);
    const r = responses[Math.min(call, responses.length - 1)]!;
    call += 1;
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body };
  }) as unknown as typeof fetch;
  return calls;
}

afterEach(() => {
  global.fetch = REAL_FETCH;
  vi.restoreAllMocks();
});

describe("requestCjAccessToken — échange de la clé API contre un accessToken", () => {
  it("POST vers /authentication/getAccessToken avec { apiKey } en JSON, jamais l'apiKey en en-tête", async () => {
    const calls = mockFetchSequence([{ status: 200, body: { code: 200, result: true, data: AUTH_SUCCESS_DATA } }]);
    await requestCjAccessToken(API_KEY);
    const [url, init] = calls[0]!;
    expect(url).toBe("https://developers.cjdropshipping.com/api2.0/v1/authentication/getAccessToken");
    expect(init!.method).toBe("POST");
    expect(JSON.parse(init!.body as string)).toEqual({ apiKey: API_KEY });
  });

  it("convertit accessTokenExpiryDate/refreshTokenExpiryDate en epoch ms réels, jamais estimés", async () => {
    mockFetchSequence([{ status: 200, body: { code: 200, result: true, data: AUTH_SUCCESS_DATA } }]);
    const bundle = await requestCjAccessToken(API_KEY);
    expect(bundle).toEqual({
      accessToken: ACCESS_TOKEN,
      accessTokenExpiresAt: new Date(AUTH_SUCCESS_DATA.accessTokenExpiryDate).getTime(),
      refreshToken: REFRESH_TOKEN,
      refreshTokenExpiresAt: new Date(AUTH_SUCCESS_DATA.refreshTokenExpiryDate).getTime(),
    });
  });

  it("lève CjApiError si la clé est refusée (result: false, ex. 'User not find')", async () => {
    mockFetchSequence([{ status: 200, body: { code: 1601000, result: false, message: "User not find" } }]);
    await expect(requestCjAccessToken(API_KEY)).rejects.toThrow(/User not find/);
  });

  it("réessaie sur 429 (limite de débit, 1 req/s documentée) avant de réussir", async () => {
    const calls = mockFetchSequence([
      { status: 429, body: {} },
      { status: 200, body: { code: 200, result: true, data: AUTH_SUCCESS_DATA } },
    ]);
    await requestCjAccessToken(API_KEY);
    expect(calls.length).toBe(2);
  });
});

describe("refreshCjAccessToken — renouvellement via refreshToken", () => {
  it("POST vers /authentication/refreshAccessToken avec { refreshToken }", async () => {
    const calls = mockFetchSequence([{ status: 200, body: { code: 200, result: true, data: AUTH_SUCCESS_DATA } }]);
    await refreshCjAccessToken(REFRESH_TOKEN);
    const [url, init] = calls[0]!;
    expect(url).toBe("https://developers.cjdropshipping.com/api2.0/v1/authentication/refreshAccessToken");
    expect(JSON.parse(init!.body as string)).toEqual({ refreshToken: REFRESH_TOKEN });
  });

  it("lève CjApiError si le refreshToken est invalide/expiré", async () => {
    mockFetchSequence([{ status: 200, body: { code: 1600003, result: false, message: "Refresh token is failure" } }]);
    await expect(refreshCjAccessToken(REFRESH_TOKEN)).rejects.toThrow(/Refresh token is failure/);
  });
});

describe("verifyCjCredentials — connexion initiale", () => {
  it("échange la clé puis confirme avec /product/list en utilisant l'ACCESSTOKEN (pas l'apiKey) en en-tête CJ-Access-Token", async () => {
    const calls = mockFetchSequence([
      { status: 200, body: { code: 200, result: true, data: AUTH_SUCCESS_DATA } },
      { status: 200, body: { code: 200, result: true, data: {} } },
    ]);
    await verifyCjCredentials({ apiKey: API_KEY });
    expect(calls.length).toBe(2);
    const [productListUrl, productListInit] = calls[1]!;
    expect(productListUrl).toContain("/product/list");
    const headers = productListInit!.headers as Record<string, string>;
    expect(headers["CJ-Access-Token"]).toBe(ACCESS_TOKEN);
    expect(headers["CJ-Access-Token"]).not.toBe(API_KEY);
  });

  it("retourne les credentials COMPLETS (apiKey + accessToken + refreshToken + expirations) à persister", async () => {
    mockFetchSequence([
      { status: 200, body: { code: 200, result: true, data: AUTH_SUCCESS_DATA } },
      { status: 200, body: { code: 200, result: true, data: {} } },
    ]);
    const result = await verifyCjCredentials({ apiKey: API_KEY });
    expect(result).toEqual({
      apiKey: API_KEY,
      accessToken: ACCESS_TOKEN,
      accessTokenExpiresAt: new Date(AUTH_SUCCESS_DATA.accessTokenExpiryDate).getTime(),
      refreshToken: REFRESH_TOKEN,
      refreshTokenExpiresAt: new Date(AUTH_SUCCESS_DATA.refreshTokenExpiryDate).getTime(),
    });
  });

  it("échoue si la clé est refusée dès l'échange (jamais d'appel product/list dans ce cas)", async () => {
    const calls = mockFetchSequence([{ status: 200, body: { code: 1601000, result: false, message: "User not find" } }]);
    await expect(verifyCjCredentials({ apiKey: API_KEY })).rejects.toThrow(/User not find/);
    expect(calls.length).toBe(1);
  });

  it("lève CjApiError si le statut HTTP de l'échange n'est pas ok", async () => {
    mockFetchSequence([{ status: 401, body: {} }]);
    await expect(verifyCjCredentials({ apiKey: API_KEY })).rejects.toBeInstanceOf(CjApiError);
  });
});

describe("queryCjVariantStock — mapping du stock réel", () => {
  const CREDS_WITH_TOKEN: CjCredentials = { apiKey: API_KEY, accessToken: ACCESS_TOKEN };

  it("refuse d'appeler CJ si aucun accessToken n'est présent dans les credentials — jamais l'apiKey en repli silencieux", async () => {
    await expect(queryCjVariantStock({ apiKey: API_KEY }, "SKU-X")).rejects.toThrow(/Jeton d'accès CJdropshipping manquant/);
  });

  it("utilise l'accessToken (pas l'apiKey) en en-tête CJ-Access-Token", async () => {
    const calls = mockFetchSequence([
      { status: 200, body: { code: 200, result: true, data: { pid: "P1", productNameEn: "X", variants: [] } } },
    ]);
    await queryCjVariantStock(CREDS_WITH_TOKEN, "SKU-INCONNU");
    const [, init] = calls[0]!;
    const headers = init!.headers as Record<string, string>;
    expect(headers["CJ-Access-Token"]).toBe(ACCESS_TOKEN);
  });

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

    const result = await queryCjVariantStock(CREDS_WITH_TOKEN, "CJXFZNZN00277-Blue LBS foreign language");
    expect(result).toEqual({ variantSku: "CJXFZNZN00277-Blue LBS foreign language", cjInventory: 15, factoryInventory: 2 });
  });

  it("retourne null si le SKU n'est pas trouvé parmi les variantes renvoyées — jamais une valeur inventée", async () => {
    mockFetchSequence([
      { status: 200, body: { code: 200, result: true, data: { pid: "P1", productNameEn: "X", variants: [] } } },
    ]);
    const result = await queryCjVariantStock(CREDS_WITH_TOKEN, "SKU-INCONNU");
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
    const result = await queryCjVariantStock(CREDS_WITH_TOKEN, "SKU-A");
    expect(result).toBeNull();
  });
});
