import { afterEach, describe, expect, it, vi } from "vitest";
import { WindsorConnectorError, getCrossChannelSpend, windsorHealthCheck } from "@/lib/ai/connectors/windsor";

/**
 * ONDEAL AI CORE — PHASE 5 (suite) : connecteur Windsor.ai réel (06/09/2026),
 * §"Connecteurs restants".
 *
 * Verrouille :
 *   - DISABLED (jamais un succès simulé) sans WINDSOR_API_KEY.
 *   - AVAILABLE/ERROR/RATE_LIMITED calculés depuis une VRAIE réponse HTTP,
 *     jamais déduits de la seule présence de la clé.
 *   - getCrossChannelSpend normalise les lignes réelles et refuse (lève)
 *     plutôt que d'inventer des métriques quand l'appel échoue.
 */

const originalKey = process.env.WINDSOR_API_KEY;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (originalKey === undefined) delete process.env.WINDSOR_API_KEY;
  else process.env.WINDSOR_API_KEY = originalKey;
});

describe("windsorHealthCheck", () => {
  it("DISABLED sans WINDSOR_API_KEY — jamais d'appel réseau", async () => {
    delete process.env.WINDSOR_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await windsorHealthCheck();
    expect(result.status).toBe("DISABLED");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("AVAILABLE sur une réponse HTTP ok", async () => {
    process.env.WINDSOR_API_KEY = "w-test-fake";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200 }));
    const result = await windsorHealthCheck();
    expect(result.status).toBe("AVAILABLE");
  });

  it("RATE_LIMITED sur un 429 réel", async () => {
    process.env.WINDSOR_API_KEY = "w-test-fake";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 429 }));
    expect((await windsorHealthCheck()).status).toBe("RATE_LIMITED");
  });

  it("ERROR sur toute autre réponse non-ok, et sur une erreur réseau", async () => {
    process.env.WINDSOR_API_KEY = "w-test-fake";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    expect((await windsorHealthCheck()).status).toBe("ERROR");

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("panne réseau")));
    const result = await windsorHealthCheck();
    expect(result.status).toBe("ERROR");
    expect(result.detail).toContain("panne réseau");
  });
});

describe("getCrossChannelSpend", () => {
  it("lit réellement les lignes et les normalise, avec les défauts (all, last_30d)", async () => {
    process.env.WINDSOR_API_KEY = "w-test-fake";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ date: "2026-08-01", source: "facebook", spend: 125.45, impressions: 10234, clicks: 342 }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const rows = await getCrossChannelSpend();
    expect(rows).toEqual([{ date: "2026-08-01", source: "facebook", spend: 125.45, impressions: 10234, clicks: 342 }]);

    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toContain("https://connectors.windsor.ai/all?");
    expect(url).toContain("api_key=w-test-fake");
    expect(url).toContain("date_preset=last_30d");
    expect(url).toContain("fields=date%2Csource%2Cspend%2Cimpressions%2Cclicks");
  });

  it("respecte un connector/datePreset explicites", async () => {
    process.env.WINDSOR_API_KEY = "w-test-fake";
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });
    vi.stubGlobal("fetch", fetchMock);

    await getCrossChannelSpend({ connector: "google_ads", datePreset: "last_7d" });
    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toContain("https://connectors.windsor.ai/google_ads?");
    expect(url).toContain("date_preset=last_7d");
  });

  it("refuse (lève) plutôt que d'inventer des métriques quand l'appel échoue", async () => {
    process.env.WINDSOR_API_KEY = "w-test-fake";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await expect(getCrossChannelSpend()).rejects.toThrow(WindsorConnectorError);
  });

  it("refuse (lève) sans appeler l'API quand WINDSOR_API_KEY est absente", async () => {
    delete process.env.WINDSOR_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(getCrossChannelSpend()).rejects.toThrow(/WINDSOR_API_KEY absent/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("normalise en null les champs manquants ou de type inattendu (jamais une valeur inventée)", async () => {
    process.env.WINDSOR_API_KEY = "w-test-fake";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [{ date: "2026-08-01" }] }) }));
    const rows = await getCrossChannelSpend();
    expect(rows).toEqual([{ date: "2026-08-01", source: null, spend: null, impressions: null, clicks: null }]);
  });
});
