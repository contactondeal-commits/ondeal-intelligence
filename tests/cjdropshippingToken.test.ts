import { describe, it, expect, afterEach, vi } from "vitest";

// getFreshCjCredentials (05/09/2026) — miroir exact du principe déjà
// appliqué à Shopify (shopify-token.ts, correctif du 04/09/2026) : jamais
// décrypter des credentials CJ bruts directement en dehors de ce module, un
// accessToken proche de l'expiration doit être renouvelé PROACTIVEMENT et
// persisté avant d'être utilisé.

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

const ENCRYPTED_MARKER = "encrypted:";
function fakeEncrypt(value: unknown): string {
  return ENCRYPTED_MARKER + JSON.stringify(value);
}
function fakeDecrypt<T>(payload: string): T {
  return JSON.parse(payload.slice(ENCRYPTED_MARKER.length)) as T;
}

const NOW = Date.now();
const FAR_FUTURE = NOW + 30 * 24 * 60 * 60 * 1000;
const NEAR_PAST = NOW - 1000;

async function loadWithMocks(opts: {
  updateIntegration?: ReturnType<typeof vi.fn>;
  requestCjAccessToken?: ReturnType<typeof vi.fn>;
  refreshCjAccessToken?: ReturnType<typeof vi.fn>;
}) {
  vi.resetModules();
  const updateIntegration = opts.updateIntegration ?? vi.fn().mockResolvedValue({});
  vi.doMock("@/lib/db", () => ({ prisma: { integration: { update: updateIntegration } } }));
  vi.doMock("@/lib/crypto", () => ({ encryptJson: fakeEncrypt, decryptJson: fakeDecrypt }));
  vi.doMock("@/lib/audit", () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }));
  vi.doMock("@/lib/integrations/cjdropshipping", async () => {
    const actual = await vi.importActual<typeof import("@/lib/integrations/cjdropshipping")>(
      "@/lib/integrations/cjdropshipping",
    );
    return {
      ...actual,
      requestCjAccessToken: opts.requestCjAccessToken ?? vi.fn(),
      refreshCjAccessToken: opts.refreshCjAccessToken ?? vi.fn(),
    };
  });
  const mod = await import("@/lib/integrations/cjdropshipping-token");
  return { getFreshCjCredentials: mod.getFreshCjCredentials, updateIntegration };
}

function integrationWith(creds: Record<string, unknown>) {
  return { id: "int1", storeId: "store1", encryptedCredentials: fakeEncrypt(creds) };
}

describe("getFreshCjCredentials", () => {
  it("retourne les credentials tels quels si l'accessToken est encore valide (marge de sécurité incluse), sans appel réseau", async () => {
    const requestCjAccessToken = vi.fn();
    const refreshCjAccessToken = vi.fn();
    const { getFreshCjCredentials } = await loadWithMocks({ requestCjAccessToken, refreshCjAccessToken });
    const creds = { apiKey: "key1", accessToken: "tok1", accessTokenExpiresAt: FAR_FUTURE, refreshToken: "r1", refreshTokenExpiresAt: FAR_FUTURE };
    const result = await getFreshCjCredentials(integrationWith(creds));
    expect(result).toEqual(creds);
    expect(requestCjAccessToken).not.toHaveBeenCalled();
    expect(refreshCjAccessToken).not.toHaveBeenCalled();
  });

  it("renouvelle via refreshToken quand l'accessToken est proche de l'expiration, et persiste le résultat", async () => {
    const newBundle = { accessToken: "tok2", accessTokenExpiresAt: FAR_FUTURE, refreshToken: "r2", refreshTokenExpiresAt: FAR_FUTURE };
    const refreshCjAccessToken = vi.fn().mockResolvedValue(newBundle);
    const requestCjAccessToken = vi.fn();
    const updateIntegration = vi.fn().mockResolvedValue({});
    const { getFreshCjCredentials } = await loadWithMocks({ requestCjAccessToken, refreshCjAccessToken, updateIntegration });
    const creds = { apiKey: "key1", accessToken: "tok-old", accessTokenExpiresAt: NEAR_PAST, refreshToken: "r1", refreshTokenExpiresAt: FAR_FUTURE };
    const result = await getFreshCjCredentials(integrationWith(creds));

    expect(refreshCjAccessToken).toHaveBeenCalledWith("r1");
    expect(requestCjAccessToken).not.toHaveBeenCalled();
    expect(result).toEqual({ apiKey: "key1", ...newBundle });
    expect(updateIntegration).toHaveBeenCalledWith({
      where: { id: "int1" },
      data: { encryptedCredentials: fakeEncrypt({ apiKey: "key1", ...newBundle }), status: "CONNECTED", lastError: null },
    });
  });

  it("redérive un accessToken via l'apiKey (jamais de reconnexion forcée) si le refreshToken est absent ou expiré", async () => {
    const newBundle = { accessToken: "tok3", accessTokenExpiresAt: FAR_FUTURE, refreshToken: "r3", refreshTokenExpiresAt: FAR_FUTURE };
    const requestCjAccessToken = vi.fn().mockResolvedValue(newBundle);
    const refreshCjAccessToken = vi.fn();
    const { getFreshCjCredentials } = await loadWithMocks({ requestCjAccessToken, refreshCjAccessToken });
    const creds = { apiKey: "key1", accessToken: "tok-old", accessTokenExpiresAt: NEAR_PAST, refreshToken: "r1", refreshTokenExpiresAt: NEAR_PAST };
    const result = await getFreshCjCredentials(integrationWith(creds));

    expect(requestCjAccessToken).toHaveBeenCalledWith("key1");
    expect(refreshCjAccessToken).not.toHaveBeenCalled();
    expect(result.accessToken).toBe("tok3");
  });

  it("filet de sécurité : si le refreshToken est rejeté par CJ, redérive via l'apiKey plutôt que d'échouer immédiatement", async () => {
    const newBundle = { accessToken: "tok4", accessTokenExpiresAt: FAR_FUTURE, refreshToken: "r4", refreshTokenExpiresAt: FAR_FUTURE };
    const refreshCjAccessToken = vi.fn().mockRejectedValue(new Error("Refresh token is failure"));
    const requestCjAccessToken = vi.fn().mockResolvedValue(newBundle);
    const { getFreshCjCredentials } = await loadWithMocks({ requestCjAccessToken, refreshCjAccessToken });
    const creds = { apiKey: "key1", accessToken: "tok-old", accessTokenExpiresAt: NEAR_PAST, refreshToken: "r1", refreshTokenExpiresAt: FAR_FUTURE };
    const result = await getFreshCjCredentials(integrationWith(creds));

    expect(refreshCjAccessToken).toHaveBeenCalledWith("r1");
    expect(requestCjAccessToken).toHaveBeenCalledWith("key1");
    expect(result.accessToken).toBe("tok4");
  });

  it("passe l'Integration en ERROR avec un message clair si même l'apiKey est refusée (dernier recours épuisé)", async () => {
    const requestCjAccessToken = vi.fn().mockRejectedValue(new Error("User not find"));
    const updateIntegration = vi.fn().mockResolvedValue({});
    const { getFreshCjCredentials } = await loadWithMocks({ requestCjAccessToken, updateIntegration });
    const creds = { apiKey: "key-revoquee", accessTokenExpiresAt: NEAR_PAST };
    await expect(getFreshCjCredentials(integrationWith(creds))).rejects.toThrow(/reconnectez CJdropshipping/);
    expect(updateIntegration).toHaveBeenCalledWith({
      where: { id: "int1" },
      data: { status: "ERROR", lastError: expect.stringContaining("User not find") },
    });
  });
});
