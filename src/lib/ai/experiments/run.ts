import { z } from "zod";
import { prisma } from "@/lib/db";
import { resolveFailoverCandidates } from "@/lib/ai/models/router";
import { AnthropicProvider } from "@/lib/ai/providers/anthropic";
import { OpenAiProvider } from "@/lib/ai/providers/openai";
import { estimateCostUsd } from "@/lib/ai/models/cost";
import { extractJson } from "@/lib/ai/supervisor/specialists";
import type { ModelProvider } from "@/lib/ai/providers/provider";

/**
 * ONDEAL AI CORE — §51/§52 "Experiment Mode" (06/09/2026), clôture réelle.
 *
 * Compare N ≥ 2 configurations RÉELLES (schema ExperimentRun/ExperimentVariant,
 * déjà posé PHASE 5) sur LE MÊME objectif — jamais une comparaison simulée ou
 * un "gagnant" tiré au hasard. Chaque variante fait un VRAI appel réseau au
 * provider/modèle qu'elle désigne (jamais un texte pré-écrit) ; un juge
 * INDÉPENDANT (§53 — jamais le variant lui-même) note ensuite chaque sortie
 * 0-100 avec une justification obligatoire.
 *
 * Délibérément PAS de FailoverProvider ici (contrairement à
 * router.ts::resolveFailoverCandidates ailleurs dans le système) : le but
 * même d'un Experiment est de savoir CE QUE CETTE configuration précise
 * produit. Un failover masquerait quel candidat a réellement répondu —
 * exactement le "mensonge d'observabilité" déjà corrigé dans
 * specialists.ts::callStructuredSpecialist. Une variante dont le provider
 * échoue est donc un résultat honnête (score absent, raison = l'erreur
 * réelle), jamais rattrapée silencieusement par un autre candidat.
 */

export type ExperimentDimension = "MODEL" | "PROMPT" | "STRATEGY" | "AGENT";
export const EXPERIMENT_DIMENSIONS: ExperimentDimension[] = ["MODEL", "PROMPT", "STRATEGY", "AGENT"];

export interface ExperimentVariantSpec {
  label: string;
  /** Omis pour PROMPT/STRATEGY : repli sur le premier candidat par défaut du système (voir resolveFailoverCandidates), jamais un provider arbitraire inventé. */
  provider?: "anthropic" | "openai";
  model?: string;
  /** Instruction de variante (PROMPT/STRATEGY) — ajoutée au system prompt de base, jamais interprétée pour MODEL/AGENT. */
  promptVariant?: string;
}

export interface ExperimentVariantRow {
  id: string;
  label: string;
  provider: string | null;
  model: string | null;
  promptVariant: string | null;
  outputText: string | null;
  costUsd: number | null;
  latencyMs: number | null;
  score: number | null;
  scoreReason: string | null;
}

export interface ExperimentSummary {
  id: string;
  objective: string;
  dimension: ExperimentDimension;
  status: "COMPLETED" | "FAILED";
  winnerVariantId: string | null;
  variants: ExperimentVariantRow[];
}

function instantiateNamedProvider(name: string): ModelProvider | null {
  if (name === "anthropic") return new AnthropicProvider();
  if (name === "openai") return new OpenAiProvider();
  return null; // provider inconnu — jamais fabriqué (même règle que router.ts::instantiateProvider)
}

const judgeScoreSchema = z.object({
  score: z.number().min(0).max(100),
  reason: z.string().min(1),
});

/**
 * Note UNE sortie de variante, de façon totalement indépendante de l'appel
 * qui l'a produite (nouvel appel réseau, nouveau contexte — jamais un
 * "auto-jugement" en réutilisant la même réponse). Lève si le juge ne
 * répond pas en JSON valide conforme — jamais un score inventé par défaut.
 */
async function scoreVariantOutput(
  judgeProvider: ModelProvider,
  judgeModel: string,
  objective: string,
  outputText: string,
): Promise<{ score: number; reason: string; costUsd?: number }> {
  const system = `Tu es un JUGE INDÉPENDANT pour le "Experiment Mode" d'OnDeal AI Lab (§51-53). On te donne un OBJECTIF réel et UNE réponse produite par une configuration candidate pour cet objectif. Note-la de 0 (ne répond pas à l'objectif, faux, ou dangereux) à 100 (répond complètement, avec preuve concrète, sans invention) — sois sévère : un 100 de complaisance est un mensonge de notation, interdit. Réponds STRICTEMENT en JSON, rien d'autre : {"score": <0-100>, "reason": "<justification citant des éléments réels de la réponse évaluée>"}.`;
  const userMessage = `OBJECTIF À ATTEINDRE :\n${objective}\n\nRÉPONSE CANDIDATE À NOTER :\n${outputText || "(réponse vide — la configuration candidate n'a produit aucun texte)"}`;
  const result = await judgeProvider.generate({ model: judgeModel, system, userMessage, maxTokens: 500 });
  const parsed = extractJson(result.text);
  const validated = judgeScoreSchema.safeParse(parsed);
  if (!validated.success) {
    throw new Error(`Sortie du juge indépendant non conforme (score 0-100 + reason attendus) : ${validated.error.message}`);
  }
  const costUsd = estimateCostUsd(judgeProvider, judgeModel, result.tokensIn, result.tokensOut);
  return { score: validated.data.score, reason: validated.data.reason, costUsd: costUsd ?? undefined };
}

/**
 * Lance un Experiment complet : exécute chaque variante réellement, fait
 * noter chaque sortie par un juge indépendant, détermine le gagnant (score
 * maximal réel ; à égalité, coût moyen le plus bas — même règle de
 * départage que router.ts::chooseModel, jamais un choix aléatoire), et
 * persiste TOUT (ExperimentRun + une ExperimentVariant par variante).
 */
export async function runExperiment(opts: {
  objective: string;
  dimension: ExperimentDimension;
  createdByUserId: string;
  variants: ExperimentVariantSpec[];
}): Promise<ExperimentSummary> {
  const { objective, dimension, createdByUserId, variants } = opts;
  if (variants.length < 2) {
    throw new Error("Un Experiment nécessite au moins 2 variantes réelles à comparer (§51) — jamais une comparaison à un seul bras.");
  }
  const labels = new Set(variants.map((v) => v.label));
  if (labels.size !== variants.length) {
    throw new Error("Chaque variante doit avoir un label unique (ex. \"A\", \"B\") — labels dupliqués reçus.");
  }

  const run = await prisma.experimentRun.create({ data: { objective, dimension, createdByUserId, status: "RUNNING" } });

  const defaultCandidates = await resolveFailoverCandidates();
  const defaultCandidate = defaultCandidates[0];
  if (!defaultCandidate) {
    await prisma.experimentRun.update({ where: { id: run.id }, data: { status: "FAILED", finishedAt: new Date() } });
    throw new Error("Aucun candidat de modèle par défaut disponible (resolveFailoverCandidates a renvoyé une liste vide) — Experiment annulé.");
  }

  const results: ExperimentVariantRow[] = [];

  for (const spec of variants) {
    const provider = spec.provider ? instantiateNamedProvider(spec.provider) : defaultCandidate.provider;
    const model = spec.model ?? defaultCandidate.model;

    if (!provider) {
      const row = await prisma.experimentVariant.create({
        data: {
          experimentId: run.id,
          label: spec.label,
          provider: spec.provider ?? null,
          model: model ?? null,
          promptVariant: spec.promptVariant ?? null,
          scoreReason: `Provider "${spec.provider}" inconnu du système — variante non exécutée (jamais un appel fabriqué).`,
        },
      });
      results.push(toRow(row));
      continue;
    }

    const system = spec.promptVariant
      ? `Tu es un spécialiste OnDeal AI Lab, variante "${spec.label}" (Experiment Mode, §51). Consigne spécifique à cette variante, à appliquer strictement : ${spec.promptVariant}`
      : `Tu es un spécialiste OnDeal AI Lab, variante "${spec.label}" (Experiment Mode, §51). Réponds directement et concrètement à l'objectif fourni, avec preuve/justification quand c'est pertinent.`;

    const startedAt = Date.now();
    try {
      const generated = await provider.generate({ model, system, userMessage: objective, maxTokens: 1500 });
      const latencyMs = Date.now() - startedAt;
      const costUsd = estimateCostUsd(provider, model, generated.tokensIn, generated.tokensOut);
      const row = await prisma.experimentVariant.create({
        data: {
          experimentId: run.id,
          label: spec.label,
          provider: provider.name,
          model,
          promptVariant: spec.promptVariant ?? null,
          outputText: generated.text,
          costUsd,
          latencyMs,
        },
      });
      results.push(toRow(row));
    } catch (err) {
      const latencyMs = Date.now() - startedAt;
      const message = err instanceof Error ? err.message : String(err);
      const row = await prisma.experimentVariant.create({
        data: {
          experimentId: run.id,
          label: spec.label,
          provider: provider.name,
          model,
          promptVariant: spec.promptVariant ?? null,
          latencyMs,
          scoreReason: `Erreur d'appel réel (variante non notée) : ${message}`,
        },
      });
      results.push(toRow(row));
    }
  }

  // §53 : juge TOUJOURS le candidat par défaut du système, jamais une des
  // variantes en cours de comparaison (sinon un candidat s'auto-jugerait
  // dans le cas dimension=MODEL) — un nouvel appel réseau indépendant par
  // variante ayant réellement produit un texte.
  for (const r of results) {
    if (r.outputText == null) continue; // déjà en échec — jamais un score inventé pour une sortie absente
    try {
      const { score, reason, costUsd: judgeCostUsd } = await scoreVariantOutput(defaultCandidate.provider, defaultCandidate.model, objective, r.outputText);
      const combinedCost = judgeCostUsd != null ? (r.costUsd ?? 0) + judgeCostUsd : r.costUsd;
      await prisma.experimentVariant.update({ where: { id: r.id }, data: { score, scoreReason: reason, costUsd: combinedCost } });
      r.score = score;
      r.scoreReason = reason;
      r.costUsd = combinedCost ?? r.costUsd;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const reason = `Notation du juge indépendant échouée (sortie candidate conservée, jamais un score inventé) : ${message}`;
      await prisma.experimentVariant.update({ where: { id: r.id }, data: { scoreReason: reason } });
      r.scoreReason = reason;
    }
  }

  const scored = results.filter((r) => r.score != null);
  let winnerVariantId: string | null = null;
  if (scored.length > 0) {
    const bestScore = Math.max(...scored.map((r) => r.score!));
    const tied = scored.filter((r) => r.score === bestScore);
    const withKnownCost = tied.filter((r) => r.costUsd != null);
    const winner = withKnownCost.length > 0 ? withKnownCost.reduce((best, r) => (r.costUsd! < best.costUsd! ? r : best)) : tied[0]!;
    winnerVariantId = winner.id;
  }

  const status: "COMPLETED" | "FAILED" = scored.length > 0 ? "COMPLETED" : "FAILED";
  await prisma.experimentRun.update({ where: { id: run.id }, data: { status, winnerVariantId, finishedAt: new Date() } });

  return { id: run.id, objective, dimension, status, winnerVariantId, variants: results };
}

function toRow(row: {
  id: string;
  label: string;
  provider: string | null;
  model: string | null;
  promptVariant: string | null;
  outputText: string | null;
  costUsd: number | null;
  latencyMs: number | null;
  score: number | null;
  scoreReason: string | null;
}): ExperimentVariantRow {
  return {
    id: row.id,
    label: row.label,
    provider: row.provider,
    model: row.model,
    promptVariant: row.promptVariant,
    outputText: row.outputText,
    costUsd: row.costUsd,
    latencyMs: row.latencyMs,
    score: row.score,
    scoreReason: row.scoreReason,
  };
}

export async function listExperiments(limit = 20) {
  return prisma.experimentRun.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { variants: { orderBy: { createdAt: "asc" } } },
  });
}

export async function getExperiment(id: string) {
  return prisma.experimentRun.findUnique({ where: { id }, include: { variants: { orderBy: { createdAt: "asc" } } } });
}
