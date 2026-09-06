import { prisma } from "@/lib/db";
import { AnthropicProvider, listAnthropicModelIds } from "@/lib/ai/providers/anthropic";
import { DEFAULT_MODEL, DEFAULT_PROVIDER } from "@/lib/ai/models/router";

/**
 * ONDEAL AI CORE — PHASE 5 : Model Console (06/09/2026), §"AI LAB → MODELS".
 *
 * Lecture RÉELLE : capabilities depuis le provider (jamais dupliquées à la
 * main), score Gauntlet réel agrégé depuis model_eval_results (même requête
 * que models/router.ts, jamais un chiffre inventé). AUCUNE écriture ici —
 * "enable/disable model, set default, force-for-test" restent un chantier
 * futur (Owner Sovereignty §5) tant qu'aucun appelant réel n'a besoin de
 * changer le comportement du Router au-delà de son repli déjà réel.
 */
export interface ModelConsoleEntry {
  provider: string;
  model: string;
  capabilities: ReturnType<AnthropicProvider["capabilities"]>;
  isDefault: boolean;
  gauntlet: { totalRuns: number; passRate: number | null; avgCostUsd: number | null };
}

export async function listModelConsole(): Promise<ModelConsoleEntry[]> {
  const provider = new AnthropicProvider();
  const modelIds = listAnthropicModelIds();

  const results = await prisma.modelEvalResult.groupBy({
    by: ["provider", "model"],
    _count: { _all: true },
    _sum: { costUsd: true },
  });
  const passedResults = await prisma.modelEvalResult.groupBy({
    by: ["provider", "model"],
    where: { passed: true },
    _count: { _all: true },
  });
  const passedByKey = new Map(passedResults.map((r) => [`${r.provider}::${r.model}`, r._count._all]));

  return modelIds.map((model) => {
    const agg = results.find((r) => r.model === model && r.provider === "anthropic");
    const key = `anthropic::${model}`;
    const totalRuns = agg?._count._all ?? 0;
    const passed = passedByKey.get(key) ?? 0;
    return {
      provider: "anthropic",
      model,
      capabilities: provider.capabilities(model),
      isDefault: model === DEFAULT_MODEL && DEFAULT_PROVIDER === "anthropic",
      gauntlet: {
        totalRuns,
        passRate: totalRuns > 0 ? passed / totalRuns : null,
        avgCostUsd: totalRuns > 0 && agg?._sum.costUsd != null ? agg._sum.costUsd / totalRuns : null,
      },
    };
  });
}
