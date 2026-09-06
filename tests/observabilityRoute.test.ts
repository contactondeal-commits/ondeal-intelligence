import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * ONDEAL AI CORE — FINAL PHASE : Observabilité réelle (06/09/2026) —
 * AI LAB → OBSERVABILITY. Verrouille GET /api/ai-lab/observability : 403
 * (jamais un calcul réel) si la capacité/session Owner est refusée ; chemin
 * heureux retourne le résumé RÉEL calculé par computeObservabilitySummary.
 */

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

async function loadRoute(opts: { ownerSessionRejection?: string; summary?: unknown }) {
  vi.resetModules();
  vi.doMock("@/lib/authz/capabilities", () => {
    class CapabilityError extends Error {}
    const requireCapabilityWithOwnerSession = opts.ownerSessionRejection
      ? vi.fn().mockRejectedValue(new CapabilityError(opts.ownerSessionRejection))
      : vi.fn().mockResolvedValue({ userId: "owner1", email: "o@x.com" });
    return { requireCapabilityWithOwnerSession, CapabilityError };
  });
  vi.doMock("@/lib/authz/ownerSession", () => ({ OwnerAuthError: class OwnerAuthError extends Error {} }));
  const computeObservabilitySummary = vi.fn().mockResolvedValue(opts.summary ?? { fake: "summary" });
  vi.doMock("@/lib/observability/engine", () => ({ computeObservabilitySummary }));
  const mod = await import("@/app/api/ai-lab/observability/route");
  return { ...mod, computeObservabilitySummary };
}

describe("GET /api/ai-lab/observability", () => {
  it("répond 403 (jamais un calcul réel) quand la capacité/session Owner est refusée", async () => {
    const { GET, computeObservabilitySummary } = await loadRoute({ ownerSessionRejection: "Session Owner requise." });
    const res = await GET();
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("Session Owner requise.");
    expect(computeObservabilitySummary).not.toHaveBeenCalled();
  });

  it("chemin heureux : retourne le résumé réel calculé", async () => {
    const summary = { sync: { last24h: { total: 0 } } };
    const { GET } = await loadRoute({ summary });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ summary });
  });
});
