import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * ONDEAL AI CORE — PHASE 2, RoutingPolicy réelle (06/09/2026).
 *
 * Verrouille :
 *   - Repli explicite (jamais un crash, jamais un choix silencieux) vers
 *     DEFAULT_MODEL quand AUCUNE évaluation n'est encore persistée.
 *   - Le Router choisit RÉELLEMENT sur la base du taux de réussite persisté
 *     — jamais un ordre arbitraire ou alphabétique.
 *   - À taux de réussite égal, départage par le coût moyen réel le plus bas
 *     — jamais un choix aléatoire entre deux modèles équivalents en qualité.
 */

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

async function loadRouter(opts: { runs?: unknown[]; results?: unknown[] }) {
  vi.resetModules();
  vi.doMock("@/lib/db", () => ({
    prisma: {
      modelEvalRun: { findMany: vi.fn().mockResolvedValue(opts.runs ?? []) },
      modelEvalResult: { findMany: vi.fn().mockResolvedValue(opts.results ?? []) },
    },
  }));
  return import("@/lib/ai/models/router");
}

describe("chooseModel — RoutingPolicy sur métriques réelles persistées", () => {
  it("se replie explicitement sur DEFAULT_MODEL quand aucune évaluation n'existe", async () => {
    const { chooseModel, DEFAULT_MODEL, DEFAULT_PROVIDER } = await loadRouter({ runs: [] });
    const choice = await chooseModel("grounding_v1");
    expect(choice.model).toBe(DEFAULT_MODEL);
    expect(choice.provider).toBe(DEFAULT_PROVIDER);
    expect(choice.reason).toMatch(/[Aa]ucune évaluation/);
  });

  it("choisit le modèle avec le MEILLEUR taux de réussite réel persisté", async () => {
    const runs = [{ id: "run1" }];
    const results = [
      { provider: "anthropic", model: "claude-haiku-4-5-20251001", passed: true, costUsd: 0.0001 },
      { provider: "anthropic", model: "claude-haiku-4-5-20251001", passed: false, costUsd: 0.0001 },
      { provider: "anthropic", model: "claude-fable-5-1", passed: true, costUsd: 0.001 },
      { provider: "anthropic", model: "claude-fable-5-1", passed: true, costUsd: 0.001 },
    ];
    const { chooseModel } = await loadRouter({ runs, results });
    const choice = await chooseModel("grounding_v1");
    // haiku : 1/2 = 50% ; fable : 2/2 = 100% — fable doit gagner malgré un coût plus élevé.
    expect(choice.model).toBe("claude-fable-5-1");
    expect(choice.reason).toMatch(/100%/);
  });

  it("départage par le coût moyen le plus bas quand les taux de réussite sont ÉGAUX", async () => {
    const runs = [{ id: "run1" }];
    const results = [
      { provider: "anthropic", model: "claude-haiku-4-5-20251001", passed: true, costUsd: 0.00005 },
      { provider: "anthropic", model: "claude-fable-5-1", passed: true, costUsd: 0.0005 },
    ];
    const { chooseModel } = await loadRouter({ runs, results });
    const choice = await chooseModel("grounding_v1");
    // Les deux à 100% — haiku moins cher doit gagner.
    expect(choice.model).toBe("claude-haiku-4-5-20251001");
  });
});
