import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * ONDEAL AI CORE — §18/§24 "Model Console écrivable + failover" (06/09/2026).
 *
 * Verrouille :
 *   - Sans configuration Owner (ModelConfig vide) : repli sur chooseModel()
 *     (Anthropic) + OpenAI en second candidat SI ET SEULEMENT SI
 *     OPENAI_API_KEY est configurée — jamais un candidat qui échouerait à
 *     coup sûr.
 *   - Avec configuration Owner : la table ModelConfig est AUTORITATIVE,
 *     dans l'ordre providerPriority croissant.
 *   - forceForTestUntil (dans le futur) prend le pas sur tout le reste —
 *     UN SEUL candidat, celui forcé.
 */

const originalOpenAiKey = process.env.OPENAI_API_KEY;

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalOpenAiKey;
});

async function loadRouter(opts: { modelConfigs?: unknown[] }) {
  vi.resetModules();
  vi.doMock("@/lib/db", () => ({
    prisma: {
      modelEvalRun: { findMany: vi.fn().mockResolvedValue([]) },
      modelEvalResult: { findMany: vi.fn().mockResolvedValue([]) },
      modelConfig: { findMany: vi.fn().mockResolvedValue(opts.modelConfigs ?? []) },
    },
  }));
  return import("@/lib/ai/models/router");
}

describe("resolveFailoverCandidates", () => {
  it("sans ModelConfig et sans OPENAI_API_KEY : un seul candidat Anthropic (repli chooseModel)", async () => {
    delete process.env.OPENAI_API_KEY;
    const { resolveFailoverCandidates } = await loadRouter({ modelConfigs: [] });
    const candidates = await resolveFailoverCandidates();
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.provider.name).toBe("anthropic");
  });

  it("sans ModelConfig mais avec OPENAI_API_KEY : deuxième candidat OpenAI ajouté (provider-independent par défaut)", async () => {
    process.env.OPENAI_API_KEY = "sk-test-fake";
    const { resolveFailoverCandidates } = await loadRouter({ modelConfigs: [] });
    const candidates = await resolveFailoverCandidates();
    expect(candidates).toHaveLength(2);
    expect(candidates[0]!.provider.name).toBe("anthropic");
    expect(candidates[1]!.provider.name).toBe("openai");
  });

  it("ModelConfig non vide est AUTORITATIVE, ordonné par providerPriority croissant", async () => {
    const { resolveFailoverCandidates } = await loadRouter({
      modelConfigs: [
        { provider: "openai", model: "gpt-4o", enabled: true, providerPriority: 0, maxCostPerCallUsd: null, forceForTestUntil: null },
        { provider: "anthropic", model: "claude-haiku-4-5-20251001", enabled: true, providerPriority: 1, maxCostPerCallUsd: null, forceForTestUntil: null },
      ],
    });
    const candidates = await resolveFailoverCandidates();
    expect(candidates.map((c) => c.provider.name)).toEqual(["openai", "anthropic"]);
    expect(candidates[0]!.model).toBe("gpt-4o");
  });

  it("forceForTestUntil dans le futur : UN SEUL candidat, celui forcé, jamais les autres lignes activées", async () => {
    const future = new Date(Date.now() + 5 * 60_000);
    const { resolveFailoverCandidates } = await loadRouter({
      modelConfigs: [
        { provider: "anthropic", model: "claude-haiku-4-5-20251001", enabled: true, providerPriority: 0, maxCostPerCallUsd: null, forceForTestUntil: null },
        { provider: "openai", model: "gpt-4o-mini", enabled: true, providerPriority: 1, maxCostPerCallUsd: null, forceForTestUntil: future },
      ],
    });
    const candidates = await resolveFailoverCandidates();
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.provider.name).toBe("openai");
    expect(candidates[0]!.model).toBe("gpt-4o-mini");
  });

  it("forceForTestUntil expiré (dans le passé) est ignoré — jamais un forçage périmé oublié", async () => {
    const past = new Date(Date.now() - 60_000);
    const { resolveFailoverCandidates } = await loadRouter({
      modelConfigs: [
        { provider: "anthropic", model: "claude-haiku-4-5-20251001", enabled: true, providerPriority: 0, maxCostPerCallUsd: null, forceForTestUntil: null },
        { provider: "openai", model: "gpt-4o-mini", enabled: true, providerPriority: 1, maxCostPerCallUsd: null, forceForTestUntil: past },
      ],
    });
    const candidates = await resolveFailoverCandidates();
    expect(candidates).toHaveLength(2); // le forçage périmé n'exclut plus les autres lignes
  });
});
