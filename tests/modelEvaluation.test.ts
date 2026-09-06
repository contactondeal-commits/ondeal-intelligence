import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * ONDEAL AI CORE — PHASE 2, EvaluationRunner réel (06/09/2026).
 *
 * Verrouille, dans l'esprit "no partial theater" (§82) :
 *   - runModelEvaluation appelle RÉELLEMENT provider.generate() pour CHAQUE
 *     (modèle × tâche) — jamais un résultat inventé.
 *   - Chaque résultat individuel est persisté (une ligne ModelEvalResult par
 *     modèle × tâche), jamais seulement une moyenne agrégée.
 *   - Un échec d'appel modèle devient un FAIL réel persisté (reason renseigné),
 *     jamais une ligne silencieusement omise (ça fausserait un taux de
 *     réussite à la hausse pour le futur Router).
 *   - costUsd est calculé depuis les VRAIS tokens + le tarif réel du
 *     provider (jamais estimé, jamais forcé à 0).
 */

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

async function loadEvaluation(opts: { createRun?: ReturnType<typeof vi.fn>; createResult?: ReturnType<typeof vi.fn> } = {}) {
  vi.resetModules();
  const createRun = opts.createRun ?? vi.fn().mockResolvedValue({ id: "run1", taskSetName: "grounding_v1" });
  const createResult = opts.createResult ?? vi.fn().mockResolvedValue({});

  vi.doMock("@/lib/db", () => ({
    prisma: {
      modelEvalRun: { create: createRun },
      modelEvalResult: { create: createResult },
    },
  }));

  const mod = await import("@/lib/ai/models/evaluation");
  return { ...mod, createRun, createResult };
}

function fakeProvider(responses: Record<string, { text: string; tokensIn: number | null; tokensOut: number | null }>) {
  return {
    name: "anthropic",
    capabilities(model: string) {
      return model === "claude-haiku-4-5-20251001"
        ? { maxContextTokens: 200_000, vision: true, toolUse: true, costPerMTokIn: 1, costPerMTokOut: 5 }
        : null;
    },
    generate: vi.fn(async (req: { userMessage: string }) => {
      const found = responses[req.userMessage];
      if (!found) throw new Error(`Pas de réponse simulée pour : ${req.userMessage}`);
      return { text: found.text, citations: [], tokensIn: found.tokensIn, tokensOut: found.tokensOut };
    }),
  };
}

describe("runModelEvaluation — TOOL EXECUTION réelle sur un jeu de tâches fixe", () => {
  it("appelle le provider pour CHAQUE (modèle × tâche) et persiste une ligne par résultat", async () => {
    const createResult = vi.fn().mockResolvedValue({});
    const { runModelEvaluation } = await loadEvaluation({ createResult });

    const task = {
      name: "t1",
      system: "s",
      userMessage: "u1",
      maxTokens: 50,
      verify: (text: string) => ({ pass: text === "ok", reason: text === "ok" ? undefined : "pas ok" }),
    };
    const provider = fakeProvider({ u1: { text: "ok", tokensIn: 10, tokensOut: 5 } });

    const summary = await runModelEvaluation({ models: ["claude-haiku-4-5-20251001"], tasks: [task], provider });

    expect(provider.generate).toHaveBeenCalledTimes(1);
    expect(createResult).toHaveBeenCalledTimes(1);
    expect(summary.results).toHaveLength(1);
    expect(summary.results[0]?.passed).toBe(true);
    // 10 tokensIn * 1$/MTok + 5 tokensOut * 5$/MTok = 0.000010 + 0.000025 = 0.000035
    expect(summary.results[0]?.costUsd).toBeCloseTo(0.000035, 9);
  });

  it("persiste un FAIL réel (jamais une ligne omise) quand verify() échoue", async () => {
    const { runModelEvaluation } = await loadEvaluation();
    const task = {
      name: "t1",
      system: "s",
      userMessage: "u1",
      maxTokens: 50,
      verify: () => ({ pass: false, reason: "format invalide" }),
    };
    const provider = fakeProvider({ u1: { text: "n'importe quoi", tokensIn: 3, tokensOut: 2 } });

    const summary = await runModelEvaluation({ models: ["claude-haiku-4-5-20251001"], tasks: [task], provider });
    expect(summary.results[0]?.passed).toBe(false);
    expect(summary.results[0]?.reason).toBe("format invalide");
  });

  it("persiste un FAIL réel (jamais une exception qui remonte) quand l'appel modèle échoue", async () => {
    const { runModelEvaluation } = await loadEvaluation();
    const task = { name: "t1", system: "s", userMessage: "u1", maxTokens: 50, verify: () => ({ pass: true }) };
    const provider = {
      name: "anthropic",
      capabilities: () => null,
      generate: vi.fn().mockRejectedValue(new Error("Anthropic API a répondu 529.")),
    };

    const summary = await runModelEvaluation({ models: ["claude-haiku-4-5-20251001"], tasks: [task], provider });
    expect(summary.results[0]?.passed).toBe(false);
    expect(summary.results[0]?.reason).toMatch(/529/);
    expect(summary.results[0]?.costUsd).toBeNull();
  });

  it("exécute bien DEUX configurations (modèles) distinctes sur le même jeu de tâches (§61 : au moins deux configurations comparables)", async () => {
    const { runModelEvaluation } = await loadEvaluation();
    const task = { name: "t1", system: "s", userMessage: "u1", maxTokens: 50, verify: () => ({ pass: true }) };
    const provider = fakeProvider({ u1: { text: "ok", tokensIn: 1, tokensOut: 1 } });

    const summary = await runModelEvaluation({
      models: ["claude-haiku-4-5-20251001", "claude-fable-5-1"],
      tasks: [task],
      provider,
    });
    expect(summary.results.map((r) => r.model)).toEqual(["claude-haiku-4-5-20251001", "claude-fable-5-1"]);
  });
});
