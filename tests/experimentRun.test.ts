import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * ONDEAL AI CORE — §51/§52/§53 "Experiment Mode" (06/09/2026).
 *
 * Verrouille, dans l'esprit "no partial theater" (§82) :
 *   - runExperiment refuse (jamais un run fabriqué) un Experiment à moins de
 *     2 variantes.
 *   - Chaque variante fait un VRAI appel provider.generate() avec le
 *     provider/modèle qu'elle désigne — jamais un failover silencieux qui
 *     masquerait quelle configuration a réellement répondu (contrairement à
 *     resolveFailoverCandidates ailleurs dans le système, DÉLIBÉRÉMENT).
 *   - Chaque sortie est notée par un juge INDÉPENDANT (jamais le variant qui
 *     s'auto-évalue) — un score non conforme lève, jamais une note inventée.
 *   - Le gagnant est le score réel le plus haut ; à égalité, le coût moyen
 *     le plus bas (même règle de départage que router.ts::chooseModel).
 *   - Un échec réel (provider inconnu, appel réseau, juge non conforme) est
 *     enregistré honnêtement (jamais une ligne omise ni un score inventé).
 */

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

interface FakeProvider {
  name: string;
  capabilities: (model: string) => { maxContextTokens: number; vision: boolean; toolUse: boolean; costPerMTokIn: number; costPerMTokOut: number } | null;
  generate: ReturnType<typeof vi.fn>;
}

function fakeProvider(name: string, responses: Record<string, { text: string; tokensIn: number | null; tokensOut: number | null } | Error>): FakeProvider {
  return {
    name,
    capabilities: () => ({ maxContextTokens: 200_000, vision: false, toolUse: true, costPerMTokIn: 1, costPerMTokOut: 5 }),
    generate: vi.fn(async (req: { model: string; userMessage: string }) => {
      const found = responses[req.model] ?? responses[req.userMessage];
      if (!found) throw new Error(`Pas de réponse simulée pour model="${req.model}" userMessage="${req.userMessage.slice(0, 40)}"`);
      if (found instanceof Error) throw found;
      return { text: found.text, citations: [], tokensIn: found.tokensIn, tokensOut: found.tokensOut };
    }),
  };
}

/** Juge indépendant simulé — répond {score, reason} en JSON, un score par appel dans l'ordre. */
function fakeJudge(scores: Array<{ score: number; reason: string } | Error>): FakeProvider {
  let call = 0;
  return {
    name: "anthropic",
    capabilities: () => ({ maxContextTokens: 200_000, vision: false, toolUse: true, costPerMTokIn: 1, costPerMTokOut: 5 }),
    generate: vi.fn(async () => {
      const next = scores[call++];
      if (!next) throw new Error("Le juge simulé a été appelé plus de fois que prévu.");
      if (next instanceof Error) throw next;
      return { text: JSON.stringify(next), citations: [], tokensIn: 20, tokensOut: 10 };
    }),
  };
}

async function loadExperimentRun(opts: {
  anthropicInstance?: FakeProvider;
  openaiInstance?: FakeProvider;
  judge?: FakeProvider;
  defaultModel?: string;
  experimentRunCreate?: ReturnType<typeof vi.fn>;
  experimentRunUpdate?: ReturnType<typeof vi.fn>;
  experimentVariantCreate?: ReturnType<typeof vi.fn>;
  experimentVariantUpdate?: ReturnType<typeof vi.fn>;
}) {
  vi.resetModules();
  const experimentRunCreate = opts.experimentRunCreate ?? vi.fn().mockResolvedValue({ id: "exp1" });
  const experimentRunUpdate = opts.experimentRunUpdate ?? vi.fn().mockResolvedValue({});
  let variantSeq = 0;
  const experimentVariantCreate =
    opts.experimentVariantCreate ??
    vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
      id: `variant${++variantSeq}`,
      label: data.label,
      provider: data.provider ?? null,
      model: data.model ?? null,
      promptVariant: data.promptVariant ?? null,
      outputText: data.outputText ?? null,
      costUsd: data.costUsd ?? null,
      latencyMs: data.latencyMs ?? null,
      score: data.score ?? null,
      scoreReason: data.scoreReason ?? null,
    }));
  const experimentVariantUpdate = opts.experimentVariantUpdate ?? vi.fn().mockResolvedValue({});

  vi.doMock("@/lib/db", () => ({
    prisma: {
      experimentRun: { create: experimentRunCreate, update: experimentRunUpdate },
      experimentVariant: { create: experimentVariantCreate, update: experimentVariantUpdate },
    },
  }));

  const judge = opts.judge ?? fakeJudge([{ score: 50, reason: "note par défaut" }]);
  const defaultModel = opts.defaultModel ?? "judge-default-model";
  vi.doMock("@/lib/ai/models/router", () => ({
    resolveFailoverCandidates: vi.fn().mockResolvedValue([{ provider: judge, model: defaultModel }]),
  }));
  const anthropicInstance = opts.anthropicInstance ?? fakeProvider("anthropic", {});
  const openaiInstance = opts.openaiInstance ?? fakeProvider("openai", {});
  vi.doMock("@/lib/ai/providers/anthropic", () => ({ AnthropicProvider: vi.fn(() => anthropicInstance) }));
  vi.doMock("@/lib/ai/providers/openai", () => ({ OpenAiProvider: vi.fn(() => openaiInstance) }));

  const mod = await import("@/lib/ai/experiments/run");
  return { ...mod, experimentRunCreate, experimentRunUpdate, experimentVariantCreate, experimentVariantUpdate, judge, anthropicInstance, openaiInstance };
}

describe("runExperiment — §51 refus d'un Experiment à un seul bras", () => {
  it("lève AVANT toute création de run quand moins de 2 variantes sont fournies", async () => {
    const { runExperiment, experimentRunCreate } = await loadExperimentRun({});
    await expect(
      runExperiment({ objective: "obj", dimension: "MODEL", createdByUserId: "u1", variants: [{ label: "A" }] }),
    ).rejects.toThrow(/au moins 2 variantes/);
    expect(experimentRunCreate).not.toHaveBeenCalled();
  });

  it("lève quand deux variantes partagent le même label", async () => {
    const { runExperiment } = await loadExperimentRun({});
    await expect(
      runExperiment({ objective: "obj", dimension: "MODEL", createdByUserId: "u1", variants: [{ label: "A" }, { label: "A" }] }),
    ).rejects.toThrow(/label unique/);
  });
});

describe("runExperiment — exécution RÉELLE de chaque variante, jamais un failover masqué", () => {
  it("appelle CHAQUE provider/modèle désigné par sa variante, persiste chaque sortie, et fait noter par un juge INDÉPENDANT", async () => {
    const anthropicInstance = fakeProvider("anthropic", { "claude-x": { text: "Réponse Claude", tokensIn: 100, tokensOut: 50 } });
    const openaiInstance = fakeProvider("openai", { "gpt-y": { text: "Réponse GPT", tokensIn: 80, tokensOut: 40 } });
    const judge = fakeJudge([
      { score: 90, reason: "Claude répond mieux à l'objectif, avec preuve concrète." },
      { score: 60, reason: "GPT reste correct mais moins détaillé." },
    ]);
    const { runExperiment, experimentVariantCreate, experimentVariantUpdate } = await loadExperimentRun({ anthropicInstance, openaiInstance, judge });

    const summary = await runExperiment({
      objective: "Rédige une fiche produit.",
      dimension: "MODEL",
      createdByUserId: "owner1",
      variants: [
        { label: "A", provider: "anthropic", model: "claude-x" },
        { label: "B", provider: "openai", model: "gpt-y" },
      ],
    });

    expect(anthropicInstance.generate).toHaveBeenCalledTimes(1);
    expect(openaiInstance.generate).toHaveBeenCalledTimes(1);
    expect(judge.generate).toHaveBeenCalledTimes(2); // un appel de notation indépendant PAR variante, jamais l'inverse
    expect(experimentVariantCreate).toHaveBeenCalledTimes(2);
    expect(experimentVariantUpdate).toHaveBeenCalledTimes(2); // score + reason écrits séparément de la création

    expect(summary.status).toBe("COMPLETED");
    expect(summary.variants.map((v) => v.provider)).toEqual(["anthropic", "openai"]);
    expect(summary.variants[0]?.outputText).toBe("Réponse Claude");
    // coût génération = (100*1 + 50*5)/1e6 = 0.00035, + coût de la notation indépendante
    // (20*1 + 10*5)/1e6 = 0.00007 — combiné, jamais un coût inventé ni le coût du juge omis.
    expect(summary.variants[0]?.costUsd).toBeCloseTo(0.00042, 9);
    expect(summary.variants[0]?.score).toBe(90);
    expect(summary.variants[1]?.score).toBe(60);
    // Claude (score 90) gagne réellement — jamais un gagnant arbitraire.
    expect(summary.winnerVariantId).toBe(summary.variants[0]?.id);
  });

  it("repose sur le premier candidat par défaut (resolveFailoverCandidates) quand une variante n'indique aucun provider/modèle — cas PROMPT/STRATEGY", async () => {
    // Le même provider par défaut sert à la fois la génération DES variantes ET
    // la notation du juge indépendant (resolveFailoverCandidates[0] réutilisé
    // pour les deux, voir run.ts) — distingue les deux usages par le system
    // prompt reçu, jamais par l'ordre d'appel (fragile).
    const defaultProvider: FakeProvider = {
      name: "anthropic",
      capabilities: () => ({ maxContextTokens: 200_000, vision: false, toolUse: true, costPerMTokIn: 1, costPerMTokOut: 5 }),
      generate: vi.fn(async (req: { model: string; system: string }) => {
        if (req.model !== "default-model") throw new Error(`modèle inattendu ${req.model}`);
        if (req.system.includes("JUGE INDÉPENDANT")) {
          return { text: JSON.stringify({ score: 75, reason: "notation réelle" }), citations: [], tokensIn: 20, tokensOut: 10 };
        }
        return { text: "sortie variante", citations: [], tokensIn: 10, tokensOut: 10 };
      }),
    };

    const { runExperiment } = await loadExperimentRun({ anthropicInstance: defaultProvider, judge: defaultProvider, defaultModel: "default-model" });
    const summary = await runExperiment({
      objective: "Compare deux stratégies de prompt.",
      dimension: "PROMPT",
      createdByUserId: "owner1",
      variants: [
        { label: "A", promptVariant: "Sois concis." },
        { label: "B", promptVariant: "Sois exhaustif." },
      ],
    });
    // 2 générations (A, B) + 2 notations indépendantes (une par variante) = 4 appels réels, jamais un provider inventé pour PROMPT/STRATEGY.
    expect(defaultProvider.generate).toHaveBeenCalledTimes(4);
    expect(summary.variants.every((v) => v.provider === "anthropic" && v.model === "default-model")).toBe(true);
    expect(summary.variants.every((v) => v.score === 75)).toBe(true);
  });

  it("enregistre honnêtement l'échec d'une variante dont le provider est inconnu — jamais un appel fabriqué", async () => {
    const anthropicInstance = fakeProvider("anthropic", { "claude-x": { text: "ok", tokensIn: 10, tokensOut: 5 } });
    const { runExperiment, experimentVariantCreate } = await loadExperimentRun({ anthropicInstance });

    const summary = await runExperiment({
      objective: "obj",
      dimension: "MODEL",
      createdByUserId: "owner1",
      variants: [
        { label: "A", provider: "anthropic", model: "claude-x" },
        // @ts-expect-error — simulate une valeur qui aurait échappé à la validation zod de la route API
        { label: "B", provider: "mistral", model: "m1" },
      ],
    });

    expect(experimentVariantCreate).toHaveBeenCalledTimes(2);
    const failed = summary.variants.find((v) => v.label === "B");
    expect(failed?.outputText).toBeNull();
    expect(failed?.scoreReason).toMatch(/inconnu/);
    expect(failed?.score).toBeNull();
  });

  it("enregistre honnêtement une erreur réseau réelle sur une variante, sans stopper les autres variantes", async () => {
    const anthropicInstance = fakeProvider("anthropic", { "claude-x": { text: "ok", tokensIn: 10, tokensOut: 5 } });
    const openaiInstance = fakeProvider("openai", { "gpt-y": new Error("OpenAI API a répondu 503.") });
    const judge = fakeJudge([{ score: 55, reason: "correct" }]); // une seule variante a produit du texte → un seul appel de notation
    const { runExperiment } = await loadExperimentRun({ anthropicInstance, openaiInstance, judge });

    const summary = await runExperiment({
      objective: "obj",
      dimension: "MODEL",
      createdByUserId: "owner1",
      variants: [
        { label: "A", provider: "anthropic", model: "claude-x" },
        { label: "B", provider: "openai", model: "gpt-y" },
      ],
    });

    expect(judge.generate).toHaveBeenCalledTimes(1); // jamais un score inventé pour la sortie absente de B
    const failed = summary.variants.find((v) => v.label === "B");
    expect(failed?.outputText).toBeNull();
    expect(failed?.scoreReason).toMatch(/503/);
    expect(summary.status).toBe("COMPLETED"); // A a réussi — l'Experiment n'est pas un échec global pour autant
    expect(summary.winnerVariantId).toBe(summary.variants.find((v) => v.label === "A")?.id);
  });

  it("marque l'Experiment FAILED (jamais un gagnant fabriqué) quand TOUTES les variantes échouent", async () => {
    const anthropicInstance = fakeProvider("anthropic", { "claude-x": new Error("panne") });
    const openaiInstance = fakeProvider("openai", { "gpt-y": new Error("panne aussi") });
    const { runExperiment } = await loadExperimentRun({ anthropicInstance, openaiInstance });

    const summary = await runExperiment({
      objective: "obj",
      dimension: "MODEL",
      createdByUserId: "owner1",
      variants: [
        { label: "A", provider: "anthropic", model: "claude-x" },
        { label: "B", provider: "openai", model: "gpt-y" },
      ],
    });
    expect(summary.status).toBe("FAILED");
    expect(summary.winnerVariantId).toBeNull();
  });

  it("départage un score à égalité par le coût le plus bas (jamais un choix aléatoire) — même règle que router.ts::chooseModel", async () => {
    const anthropicInstance = fakeProvider("anthropic", { "claude-x": { text: "ok A", tokensIn: 1000, tokensOut: 1000 } }); // coût élevé
    const openaiInstance = fakeProvider("openai", { "gpt-y": { text: "ok B", tokensIn: 10, tokensOut: 10 } }); // coût faible
    const judge = fakeJudge([{ score: 80, reason: "égal" }, { score: 80, reason: "égal" }]);
    const { runExperiment } = await loadExperimentRun({ anthropicInstance, openaiInstance, judge });

    const summary = await runExperiment({
      objective: "obj",
      dimension: "MODEL",
      createdByUserId: "owner1",
      variants: [
        { label: "A", provider: "anthropic", model: "claude-x" },
        { label: "B", provider: "openai", model: "gpt-y" },
      ],
    });
    const cheaper = summary.variants.find((v) => v.label === "B");
    expect(summary.winnerVariantId).toBe(cheaper?.id);
  });

  it("conserve la sortie candidate (jamais un score inventé) quand le juge indépendant échoue à noter", async () => {
    const anthropicInstance = fakeProvider("anthropic", { "claude-x": { text: "sortie réelle", tokensIn: 10, tokensOut: 5 } });
    const openaiInstance = fakeProvider("openai", { "gpt-y": { text: "autre sortie", tokensIn: 10, tokensOut: 5 } });
    const judge = fakeJudge([new Error("Juge : réponse non JSON."), { score: 65, reason: "ok" }]);
    const { runExperiment } = await loadExperimentRun({ anthropicInstance, openaiInstance, judge });

    const summary = await runExperiment({
      objective: "obj",
      dimension: "MODEL",
      createdByUserId: "owner1",
      variants: [
        { label: "A", provider: "anthropic", model: "claude-x" },
        { label: "B", provider: "openai", model: "gpt-y" },
      ],
    });
    const a = summary.variants.find((v) => v.label === "A");
    expect(a?.outputText).toBe("sortie réelle"); // jamais effacée par l'échec de notation
    expect(a?.score).toBeNull();
    expect(a?.scoreReason).toMatch(/Notation du juge indépendant échouée/);
  });
});
