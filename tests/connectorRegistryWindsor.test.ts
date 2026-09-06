import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * ONDEAL AI CORE — PHASE 5 (suite) : promotion du connecteur Windsor.ai en
 * connecteur RÉEL dans le Connector Registry (06/09/2026), §"Connecteurs
 * restants".
 *
 * Verrouille :
 *   - "windsor_ai" apparaît EXACTEMENT une fois dans CONNECTOR_REGISTRY,
 *     avec hasRealImplementation:true (jamais un doublon architecture-only
 *     + réel coexistant silencieusement).
 *   - getConnectorHealth("windsor_ai") délègue RÉELLEMENT à
 *     windsorHealthCheck et traduit correctement chacun de ses statuts vers
 *     ConnectorStatus.
 */

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

async function loadRegistry(windsorHealthCheck: ReturnType<typeof vi.fn>) {
  vi.resetModules();
  vi.doMock("@/lib/ai/connectors/windsor", () => ({ windsorHealthCheck }));
  vi.doMock("@/lib/ai/connectors/klaviyo", () => ({ klaviyoHealthCheck: vi.fn().mockResolvedValue({ status: "DISABLED", detail: "x" }) }));
  vi.doMock("@/lib/ai/connectors/github", () => ({ githubHealthCheck: vi.fn().mockResolvedValue({ status: "NOT_CONNECTED", detail: "x", repoFullName: null, scopes: null, lastHealthCheckAt: null }) }));
  return import("@/lib/ai/connectors/registry");
}

describe("Connector Registry — windsor_ai (promu réel)", () => {
  it("apparaît une seule fois, avec hasRealImplementation:true et le bon capabilities/requiredSecrets", async () => {
    const { CONNECTOR_REGISTRY } = await loadRegistry(vi.fn().mockResolvedValue({ status: "DISABLED", detail: "x" }));
    const matches = CONNECTOR_REGISTRY.filter((c) => c.id === "windsor_ai");
    expect(matches).toHaveLength(1);
    expect(matches[0]!.hasRealImplementation).toBe(true);
    expect(matches[0]!.capabilities).toEqual(["cross_channel_analytics"]);
    expect(matches[0]!.requiredSecrets).toEqual(["WINDSOR_API_KEY"]);
  });

  it.each([
    ["AVAILABLE", "CONNECTED"],
    ["DISABLED", "NOT_CONFIGURED"],
    ["ERROR", "ERROR"],
    ["RATE_LIMITED", "DEGRADED"],
  ] as const)("getConnectorHealth traduit windsorHealthCheck status=%s en ConnectorStatus=%s", async (windsorStatus, expected) => {
    const { getConnectorHealth } = await loadRegistry(vi.fn().mockResolvedValue({ status: windsorStatus, detail: "détail réel" }));
    const health = await getConnectorHealth("windsor_ai");
    expect(health.status).toBe(expected);
    expect(health.detail).toBe("détail réel");
  });
});
