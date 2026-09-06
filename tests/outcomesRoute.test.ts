import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * ONDEAL AI CORE — FINAL PHASE : Outcome/ROI Engine (06/09/2026) — AI LAB → OUTCOMES.
 *
 * Verrouille GET /api/ai-lab/outcomes :
 *   - 403 (jamais un calcul réel) si la capacité/session Owner est refusée.
 *   - Chemin heureux : retourne le résumé RÉEL calculé par computeOutcomeSummary.
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
  const computeOutcomeSummary = vi.fn().mockResolvedValue(opts.summary ?? { fake: "summary" });
  vi.doMock("@/lib/ai/outcomes/engine", () => ({ computeOutcomeSummary }));
  const mod = await import("@/app/api/ai-lab/outcomes/route");
  return { ...mod, computeOutcomeSummary };
}

describe("GET /api/ai-lab/outcomes", () => {
  it("répond 403 (jamais un calcul réel) quand la capacité/session Owner est refusée", async () => {
    const { GET, computeOutcomeSummary } = await loadRoute({ ownerSessionRejection: "Session Owner requise." });
    const res = await GET();
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("Session Owner requise.");
    expect(computeOutcomeSummary).not.toHaveBeenCalled();
  });

  it("chemin heureux : retourne le résumé réel calculé", async () => {
    const summary = { missions: { total: 3 }, evolution: { total: 1 }, experiments: { total: 0 }, generatedAt: "2026-09-06T00:00:00.000Z" };
    const { GET } = await loadRoute({ summary });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ summary });
  });
});
