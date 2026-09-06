import { afterEach, describe, expect, it, vi } from "vitest";
import { KlaviyoConnectorError, klaviyoHealthCheck, listCampaigns } from "@/lib/ai/connectors/klaviyo";

/**
 * ONDEAL AI CORE — PHASE 5 (suite) : connecteur Klaviyo réel (06/09/2026),
 * §"Connecteurs restants".
 *
 * Verrouille :
 *   - DISABLED (jamais un succès simulé) sans KLAVIYO_API_KEY.
 *   - AVAILABLE/ERROR/RATE_LIMITED calculés depuis une VRAIE réponse HTTP
 *     (GET /accounts/), jamais déduits de la seule présence de la clé.
 *   - listCampaigns filtre explicitement le canal "email" (contrat imposé
 *     par l'API Klaviyo) et refuse (lève) plutôt que d'inventer des
 *     campagnes quand l'appel échoue.
 */

const originalKey = process.env.KLAVIYO_API_KEY;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (originalKey === undefined) delete process.env.KLAVIYO_API_KEY;
  else process.env.KLAVIYO_API_KEY = originalKey;
});

describe("klaviyoHealthCheck", () => {
  it("DISABLED sans KLAVIYO_API_KEY — jamais d'appel réseau", async () => {
    delete process.env.KLAVIYO_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await klaviyoHealthCheck();
    expect(result.status).toBe("DISABLED");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("AVAILABLE quand GET /accounts/ répond ok", async () => {
    process.env.KLAVIYO_API_KEY = "pk_test_fake";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200 }));
    const result = await klaviyoHealthCheck();
    expect(result.status).toBe("AVAILABLE");
  });

  it("RATE_LIMITED sur un 429 réel", async () => {
    process.env.KLAVIYO_API_KEY = "pk_test_fake";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 429 }));
    const result = await klaviyoHealthCheck();
    expect(result.status).toBe("RATE_LIMITED");
  });

  it("ERROR sur toute autre réponse non-ok", async () => {
    process.env.KLAVIYO_API_KEY = "pk_test_fake";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    const result = await klaviyoHealthCheck();
    expect(result.status).toBe("ERROR");
    expect(result.detail).toContain("401");
  });

  it("ERROR sur une erreur réseau (jamais un crash non capturé)", async () => {
    process.env.KLAVIYO_API_KEY = "pk_test_fake";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("panne réseau")));
    const result = await klaviyoHealthCheck();
    expect(result.status).toBe("ERROR");
    expect(result.detail).toContain("panne réseau");
  });
});

describe("listCampaigns", () => {
  it("lit réellement les campagnes email et les normalise", async () => {
    process.env.KLAVIYO_API_KEY = "pk_test_fake";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: "c1", attributes: { name: "Promo Été", status: "Sent", send_time: "2026-08-01T00:00:00Z" } }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const campaigns = await listCampaigns(10);
    expect(campaigns).toEqual([{ id: "c1", name: "Promo Été", status: "Sent", channel: "email", sentAt: "2026-08-01T00:00:00Z" }]);

    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toContain("filter=equals(messages.channel,'email')");
    expect(url).toContain("page[size]=10");
    const [, init] = fetchMock.mock.calls[0]!;
    expect((init as { headers: Record<string, string> }).headers.Authorization).toBe("Klaviyo-API-Key pk_test_fake");
  });

  it("refuse (lève) plutôt que d'inventer des campagnes quand l'appel échoue", async () => {
    process.env.KLAVIYO_API_KEY = "pk_test_fake";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await expect(listCampaigns()).rejects.toThrow(KlaviyoConnectorError);
  });

  it("refuse (lève) sans appeler l'API quand KLAVIYO_API_KEY est absente", async () => {
    delete process.env.KLAVIYO_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(listCampaigns()).rejects.toThrow(/KLAVIYO_API_KEY absent/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
