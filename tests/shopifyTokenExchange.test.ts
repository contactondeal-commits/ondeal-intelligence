import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { exchangeIdTokenForOfflineAccessToken, refreshOfflineAccessToken } from "@/lib/integrations/shopify-embedded";
import { ShopifyApiError } from "@/lib/integrations/shopify";

// CORRECTIF PRODUCTION (04/09/2026) — le flux app embarquée demande un
// jeton EXPIRANT (`expiring=1`) mais rien ne capturait son refresh_token ni
// sa vraie expiration : chaque jeton mourait silencieusement ~1h après
// l'échange, sans jamais pouvoir être renouvelé. Ces tests verrouillent la
// correction : expires_in → expiresAt (horodatage absolu, jamais une durée
// relative), refresh_token propagé, et le cas classique (aucun des deux
// champs dans la réponse Shopify) reste traité comme non-expirant.

const REAL_FETCH = global.fetch;

function mockFetchOnce(status: number, body: unknown) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  process.env.SHOPIFY_API_KEY = "test-api-key";
  process.env.SHOPIFY_API_SECRET = "test-api-secret";
});

afterEach(() => {
  global.fetch = REAL_FETCH;
  vi.restoreAllMocks();
});

describe("exchangeIdTokenForOfflineAccessToken — jeton expirant (expiring=1)", () => {
  it("convertit expires_in (secondes, relatif) en expiresAt (horodatage absolu réel), et propage refresh_token", async () => {
    const before = Date.now();
    mockFetchOnce(200, { access_token: "shpat_abc", scope: "read_orders,write_products", expires_in: 3600, refresh_token: "shprt_xyz" });

    const result = await exchangeIdTokenForOfflineAccessToken("test-shop.myshopify.com", "id-token-value");

    expect(result.accessToken).toBe("shpat_abc");
    expect(result.refreshToken).toBe("shprt_xyz");
    expect(result.expiresAt).toBeDefined();
    // ~3600s après l'appel, jamais une valeur brute de 3600 stockée telle quelle.
    expect(result.expiresAt!).toBeGreaterThanOrEqual(before + 3600 * 1000);
    expect(result.expiresAt!).toBeLessThanOrEqual(Date.now() + 3600 * 1000 + 1000);
  });

  it("envoie bien expiring=1 dans la requête d'échange (comportement voulu, source du bug corrigé)", async () => {
    mockFetchOnce(200, { access_token: "shpat_abc", scope: "read_orders" });
    await exchangeIdTokenForOfflineAccessToken("test-shop.myshopify.com", "id-token-value");

    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const body = call[1].body as URLSearchParams;
    expect(body.get("expiring")).toBe("1");
    expect(body.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:token-exchange");
  });

  it("ne laisse jamais refreshToken/expiresAt à une fausse valeur quand Shopify ne les renvoie pas (jeton non-expirant)", async () => {
    mockFetchOnce(200, { access_token: "shpat_abc", scope: "read_orders" });
    const result = await exchangeIdTokenForOfflineAccessToken("test-shop.myshopify.com", "id-token-value");
    expect(result.refreshToken).toBeUndefined();
    expect(result.expiresAt).toBeUndefined();
  });

  it("lève une ShopifyApiError explicite si Shopify refuse l'échange (statut non-ok)", async () => {
    mockFetchOnce(401, { errors: "invalid_grant" });
    await expect(exchangeIdTokenForOfflineAccessToken("test-shop.myshopify.com", "bad-token")).rejects.toThrow(ShopifyApiError);
  });

  it("lève une erreur si la réponse Shopify est OK mais sans access_token (jamais un jeton vide silencieusement accepté)", async () => {
    mockFetchOnce(200, { scope: "read_orders" });
    await expect(exchangeIdTokenForOfflineAccessToken("test-shop.myshopify.com", "id-token-value")).rejects.toThrow(ShopifyApiError);
  });
});

describe("refreshOfflineAccessToken — renouvellement (grant_type=refresh_token)", () => {
  it("échange le refresh_token contre un nouveau couple access/refresh token et une nouvelle expiration réelle", async () => {
    mockFetchOnce(200, { access_token: "shpat_new", scope: "read_orders", expires_in: 3600, refresh_token: "shprt_rotated" });

    const result = await refreshOfflineAccessToken("test-shop.myshopify.com", "shprt_old");

    expect(result.accessToken).toBe("shpat_new");
    expect(result.refreshToken).toBe("shprt_rotated"); // rotation — jamais réutiliser l'ancien
    expect(result.expiresAt).toBeGreaterThan(Date.now());
  });

  it("envoie grant_type=refresh_token avec le refresh_token fourni, jamais un access_token existant", async () => {
    mockFetchOnce(200, { access_token: "shpat_new" });
    await refreshOfflineAccessToken("test-shop.myshopify.com", "shprt_old");

    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const body = call[1].body as URLSearchParams;
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("shprt_old");
  });

  it("lève une ShopifyApiError si le refresh_token est expiré/révoqué (invalid_grant) — jamais un succès silencieux", async () => {
    mockFetchOnce(400, { error: "invalid_grant" });
    await expect(refreshOfflineAccessToken("test-shop.myshopify.com", "shprt_expired")).rejects.toThrow(ShopifyApiError);
  });
});
