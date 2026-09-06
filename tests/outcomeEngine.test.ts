import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * ONDEAL AI CORE — FINAL PHASE : Outcome/ROI Engine (06/09/2026).
 *
 * Verrouille :
 *   - Chaque métrique vient RÉELLEMENT des tables agrégées (StorefrontMission,
 *     EvolutionProposal, ExperimentRun/Variant) — jamais une valeur codée en dur.
 *   - Un dénominateur nul retourne `null` (jamais un taux fabriqué du type "0%").
 *   - `realShippedPrUrls` ne contient que des URLs réellement écrites par
 *     evolution/ship.ts (shippedPrUrl non-null), jamais un placeholder.
 */

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

async function loadEngine(prismaMock: Record<string, unknown>) {
  vi.resetModules();
  vi.doMock("@/lib/db", () => ({ prisma: prismaMock }));
  return import("@/lib/ai/outcomes/engine");
}

describe("computeOutcomeSummary", () => {
  it("calcule les métriques missions réelles (coût total/moyen, taux de succès sur les seuls états terminaux)", async () => {
    const { computeOutcomeSummary } = await loadEngine({
      storefrontMission: {
        groupBy: vi.fn().mockResolvedValue([
          { status: "SUCCEEDED", _count: { _all: 6 } },
          { status: "FAILED", _count: { _all: 2 } },
          { status: "RUNNING", _count: { _all: 1 } },
        ]),
        aggregate: vi.fn().mockResolvedValue({ _sum: { totalCostUsd: 12.345 }, _avg: { totalCostUsd: 1.371666 }, _count: { _all: 9 } }),
      },
      evolutionProposal: { groupBy: vi.fn().mockResolvedValue([]), findMany: vi.fn().mockResolvedValue([]) },
      experimentRun: { findMany: vi.fn().mockResolvedValue([]) },
    });

    const summary = await computeOutcomeSummary();
    expect(summary.missions.total).toBe(9);
    expect(summary.missions.totalCostUsd).toBe(12.35);
    expect(summary.missions.avgCostUsd).toBe(1.37);
    // 6 SUCCEEDED / (6 SUCCEEDED + 2 FAILED + 0 CANCELLED) = 75.0%, RUNNING exclu du dénominateur (pas encore un résultat)
    expect(summary.missions.successRatePct).toBe(75);
  });

  it("retourne null (jamais 0% fabriqué) quand aucune mission n'a atteint un état terminal", async () => {
    const { computeOutcomeSummary } = await loadEngine({
      storefrontMission: {
        groupBy: vi.fn().mockResolvedValue([{ status: "PLANNING", _count: { _all: 3 } }]),
        aggregate: vi.fn().mockResolvedValue({ _sum: { totalCostUsd: null }, _avg: { totalCostUsd: null }, _count: { _all: 3 } }),
      },
      evolutionProposal: { groupBy: vi.fn().mockResolvedValue([]), findMany: vi.fn().mockResolvedValue([]) },
      experimentRun: { findMany: vi.fn().mockResolvedValue([]) },
    });

    const summary = await computeOutcomeSummary();
    expect(summary.missions.successRatePct).toBeNull();
    expect(summary.missions.avgCostUsd).toBeNull();
    expect(summary.missions.totalCostUsd).toBe(0);
  });

  it("calcule le taux de livraison Evolution sur les seules décisions déjà tranchées, et expose les vraies URLs de PR livrées", async () => {
    const { computeOutcomeSummary } = await loadEngine({
      storefrontMission: {
        groupBy: vi.fn().mockResolvedValue([]),
        aggregate: vi.fn().mockResolvedValue({ _sum: { totalCostUsd: null }, _avg: { totalCostUsd: null }, _count: { _all: 0 } }),
      },
      evolutionProposal: {
        groupBy: vi.fn().mockResolvedValue([
          { status: "PROPOSED", _count: { _all: 4 } },
          { status: "APPROVED", _count: { _all: 1 } },
          { status: "REJECTED", _count: { _all: 1 } },
          { status: "SHIPPED", _count: { _all: 2 } },
        ]),
        findMany: vi.fn().mockResolvedValue([{ shippedPrUrl: "https://github.com/contactondeal-commits/ondeal-intelligence/pull/12" }, { shippedPrUrl: "https://github.com/contactondeal-commits/ondeal-intelligence/pull/13" }]),
      },
      experimentRun: { findMany: vi.fn().mockResolvedValue([]) },
    });

    const summary = await computeOutcomeSummary();
    // 2 SHIPPED / (1 APPROVED + 1 REJECTED + 2 SHIPPED) = 50.0% — PROPOSED (pas encore décidé) exclu du dénominateur
    expect(summary.evolution.shipRatePct).toBe(50);
    expect(summary.evolution.shippedCount).toBe(2);
    expect(summary.evolution.realShippedPrUrls).toEqual([
      "https://github.com/contactondeal-commits/ondeal-intelligence/pull/12",
      "https://github.com/contactondeal-commits/ondeal-intelligence/pull/13",
    ]);
  });

  it("calcule le coût moyen réel par expérience et le score moyen des variantes gagnantes réelles", async () => {
    const { computeOutcomeSummary } = await loadEngine({
      storefrontMission: {
        groupBy: vi.fn().mockResolvedValue([]),
        aggregate: vi.fn().mockResolvedValue({ _sum: { totalCostUsd: null }, _avg: { totalCostUsd: null }, _count: { _all: 0 } }),
      },
      evolutionProposal: { groupBy: vi.fn().mockResolvedValue([]), findMany: vi.fn().mockResolvedValue([]) },
      experimentRun: {
        findMany: vi.fn().mockResolvedValue([
          {
            status: "COMPLETED",
            winnerVariantId: "v1",
            variants: [
              { id: "v1", costUsd: 0.02, score: 90 },
              { id: "v2", costUsd: 0.03, score: 60 },
            ],
          },
          {
            status: "RUNNING",
            winnerVariantId: null,
            variants: [{ id: "v3", costUsd: 0.01, score: null }],
          },
        ]),
      },
    });

    const summary = await computeOutcomeSummary();
    expect(summary.experiments.total).toBe(2);
    expect(summary.experiments.completed).toBe(1);
    expect(summary.experiments.avgWinnerScore).toBe(90); // seule la variante gagnante réelle (v1) compte, jamais une moyenne de toutes les variantes
    expect(summary.experiments.avgCostPerExperimentUsd).toBeCloseTo((0.05 + 0.01) / 2, 5);
    expect(summary.experiments.winRatePct).toBeNull(); // écart honnête documenté : pas de champ "isControl" structuré encore
  });
});
