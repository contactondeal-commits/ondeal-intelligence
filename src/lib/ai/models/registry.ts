import { prisma } from "@/lib/db";
import { AnthropicProvider, listAnthropicModelIds } from "@/lib/ai/providers/anthropic";
import { OpenAiProvider, listOpenAiModelIds, openAiHealthCheck } from "@/lib/ai/providers/openai";
import { DEFAULT_MODEL, DEFAULT_PROVIDER } from "@/lib/ai/models/router";
import type { ModelCapabilities } from "@/lib/ai/providers/provider";

/**
 * ONDEAL AI CORE — PHASE 5 : Model Console (06/09/2026), §"AI LAB → MODELS".
 *
 * Lecture RÉELLE : capabilities depuis le provider (jamais dupliquées à la
 * main), score Gauntlet réel agrégé depuis model_eval_results (même requête
 * que models/router.ts, jamais un chiffre inventé).
 *
 * §18 CLÔTURE (06/09/2026) : cette console N'EST PLUS lecture seule.
 * `configOverride` reflète l'état RÉEL de la table ModelConfig — la même
 * table que router.ts (`resolveFailoverCandidates`) lit pour construire le
 * FailoverProvider réel de chaque mission. Un changement ici a un effet
 * RUNTIME immédiat sur la prochaine mission lancée, jamais un simple
 * affichage déconnecté de l'exécution (voir routes d'écriture dans
 * /api/ai-lab/models/config).
 */
export interface ModelConsoleEntry {
  provider: string;
  model: string;
  capabilities: ModelCapabilities | null;
  isDefault: boolean; // vrai repli statique DEFAULT_MODEL/DEFAULT_PROVIDER, utilisé seulement quand ModelConfig est vide (voir router.ts)
  gauntlet: { totalRuns: number; passRate: number | null; avgCostUsd: number | null };
  configOverride: {
    enabled: boolean;
    isDefault: boolean;
    forceForTestUntil: string | null;
    maxCostPerCallUsd: number | null;
    providerPriority: number;
  } | null; // null = l'Owner n'a jamais touché ce modèle — le Router utilise son repli par défaut (chooseModel/DEFAULT_MODEL)
  providerHealth?: { status: string; detail: string }; // rempli uniquement pour openai aujourd'hui (anthropic n'a pas encore de health check générique séparé — voir assistant.ts pour son propre health check applicatif)
}

export async function listModelConsole(): Promise<ModelConsoleEntry[]> {
  const anthropic = new AnthropicProvider();
  const openai = new OpenAiProvider();
  const catalogue: Array<{ provider: string; model: string; capabilities: ModelCapabilities | null }> = [
    ...listAnthropicModelIds().map((model) => ({ provider: "anthropic", model, capabilities: anthropic.capabilities(model) })),
    ...listOpenAiModelIds().map((model) => ({ provider: "openai", model, capabilities: openai.capabilities(model) })),
  ];

  const results = await prisma.modelEvalResult.groupBy({ by: ["provider", "model"], _count: { _all: true }, _sum: { costUsd: true } });
  const passedResults = await prisma.modelEvalResult.groupBy({ by: ["provider", "model"], where: { passed: true }, _count: { _all: true } });
  const passedByKey = new Map(passedResults.map((r) => [`${r.provider}::${r.model}`, r._count._all]));

  const configs = await prisma.modelConfig.findMany();
  const configByKey = new Map(configs.map((c) => [`${c.provider}::${c.model}`, c]));

  const openaiHealth = await openAiHealthCheck();

  return catalogue.map(({ provider, model, capabilities }) => {
    const key = `${provider}::${model}`;
    const agg = results.find((r) => r.model === model && r.provider === provider);
    const totalRuns = agg?._count._all ?? 0;
    const passed = passedByKey.get(key) ?? 0;
    const cfg = configByKey.get(key);
    return {
      provider,
      model,
      capabilities,
      isDefault: model === DEFAULT_MODEL && DEFAULT_PROVIDER === provider,
      gauntlet: {
        totalRuns,
        passRate: totalRuns > 0 ? passed / totalRuns : null,
        avgCostUsd: totalRuns > 0 && agg?._sum.costUsd != null ? agg._sum.costUsd / totalRuns : null,
      },
      configOverride: cfg
        ? {
            enabled: cfg.enabled,
            isDefault: cfg.isDefault,
            forceForTestUntil: cfg.forceForTestUntil ? cfg.forceForTestUntil.toISOString() : null,
            maxCostPerCallUsd: cfg.maxCostPerCallUsd,
            providerPriority: cfg.providerPriority,
          }
        : null,
      providerHealth: provider === "openai" ? openaiHealth : undefined,
    };
  });
}

/**
 * Écrit/met à jour UNE ligne ModelConfig (upsert) — jamais une écriture
 * partielle ambiguë : chaque champ omis garde sa valeur EXISTANTE (ou le
 * défaut Prisma à la création), jamais réinitialisé à l'aveugle.
 *
 * `isDefault: true` est exclusif — impose au plus une ligne true à la fois
 * (§18), en code (jamais une contrainte DB, pour rester une transaction
 * simple et lisible).
 */
export async function setModelConfig(
  updatedByUserId: string,
  input: {
    provider: string;
    model: string;
    enabled?: boolean;
    isDefault?: boolean;
    forceForTestMinutes?: number | null; // null = annule un force-for-test en cours ; nombre = fenêtre en minutes à partir de maintenant
    maxCostPerCallUsd?: number | null;
    providerPriority?: number;
  }
) {
  return prisma.$transaction(async (tx) => {
    if (input.isDefault === true) {
      await tx.modelConfig.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
    }
    const forceForTestUntil = input.forceForTestMinutes === undefined ? undefined : input.forceForTestMinutes === null ? null : new Date(Date.now() + input.forceForTestMinutes * 60_000);

    return tx.modelConfig.upsert({
      where: { provider_model: { provider: input.provider, model: input.model } },
      create: {
        provider: input.provider,
        model: input.model,
        enabled: input.enabled ?? true,
        isDefault: input.isDefault ?? false,
        forceForTestUntil: forceForTestUntil ?? null,
        maxCostPerCallUsd: input.maxCostPerCallUsd ?? null,
        providerPriority: input.providerPriority ?? 0,
        updatedByUserId,
      },
      update: {
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
        ...(forceForTestUntil !== undefined ? { forceForTestUntil } : {}),
        ...(input.maxCostPerCallUsd !== undefined ? { maxCostPerCallUsd: input.maxCostPerCallUsd } : {}),
        ...(input.providerPriority !== undefined ? { providerPriority: input.providerPriority } : {}),
        updatedByUserId,
      },
    });
  });
}

/** Supprime l'override — le modèle retombe sur le comportement par défaut du Router (chooseModel/DEFAULT_MODEL), jamais un état "disabled fantôme". */
export async function deleteModelConfig(provider: string, model: string) {
  await prisma.modelConfig.deleteMany({ where: { provider, model } });
}
