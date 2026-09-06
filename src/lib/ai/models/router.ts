import { prisma } from "@/lib/db";
import { GROUNDING_TASK_SET } from "@/lib/ai/models/tasks";
import { AnthropicProvider } from "@/lib/ai/providers/anthropic";
import { OpenAiProvider } from "@/lib/ai/providers/openai";
import type { FailoverCandidate } from "@/lib/ai/providers/failover";
import type { ModelProvider } from "@/lib/ai/providers/provider";

/**
 * ONDEAL AI CORE — PHASE 2 : RoutingPolicy réelle (06/09/2026).
 *
 * `chooseModel` choisit un modèle à partir des métriques RÉELLEMENT
 * persistées par l'EvaluationRunner (evaluation.ts) — jamais un choix
 * arbitraire ou un score inventé. Règle de sélection, volontairement
 * simple (§83 : la solution la plus simple qui reste correcte) :
 *   1. Parmi les modèles ayant au moins MIN_SAMPLES résultats persistés
 *      pour ce taskSetName, ne retenir que ceux dont le taux de réussite
 *      est le taux de réussite MAXIMAL observé.
 *   2. Entre modèles à égalité de taux de réussite, choisir celui au coût
 *      moyen par appel le plus bas (coût-aware, § budget de la commande).
 *   3. Repli explicite et documenté (jamais un choix silencieux) vers
 *      DEFAULT_MODEL si aucune donnée d'évaluation n'existe encore pour ce
 *      taskSetName — c'est l'état du système avant le premier run réel.
 */

export const DEFAULT_MODEL = "claude-haiku-4-5-20251001"; // même repli que l'ancien REASON_MODEL en dur — comportement identique tant qu'aucune évaluation n'a encore tourné.
export const DEFAULT_PROVIDER = "anthropic";
const MIN_SAMPLES = 1; // volontairement bas : un seul run réel suffit à sortir du repli par défaut, cohérent avec le budget "petit run, gain démontrable" plutôt qu'un seuil arbitraire élevé jamais atteint sans dépense supplémentaire.

export interface ModelChoice {
  provider: string;
  model: string;
  reason: string;
}

interface Aggregate {
  provider: string;
  model: string;
  total: number;
  passed: number;
  costSum: number;
  costSamples: number;
}

/**
 * Agrège les résultats persistés par (provider, model) pour un taskSetName
 * donné, sur les `lookbackResults` lignes les plus récentes AU TOTAL (toutes
 * combinaisons confondues) — une fenêtre glissante simple, jamais un
 * historique infini qui figerait la décision sur un très vieux run.
 */
async function aggregate(taskSetName: string, lookbackResults: number): Promise<Aggregate[]> {
  const runs = await prisma.modelEvalRun.findMany({
    where: { taskSetName },
    orderBy: { createdAt: "desc" },
    take: 20, // fenêtre de runs récents — évite de charger tout l'historique pour agréger
    select: { id: true },
  });
  const runIds = runs.map((r) => r.id);
  if (runIds.length === 0) return [];

  const results = await prisma.modelEvalResult.findMany({
    where: { runId: { in: runIds } },
    orderBy: { createdAt: "desc" },
    take: lookbackResults,
    select: { provider: true, model: true, passed: true, costUsd: true },
  });

  const byKey = new Map<string, Aggregate>();
  for (const r of results) {
    const key = `${r.provider}::${r.model}`;
    const agg = byKey.get(key) ?? { provider: r.provider, model: r.model, total: 0, passed: 0, costSum: 0, costSamples: 0 };
    agg.total += 1;
    if (r.passed) agg.passed += 1;
    if (r.costUsd != null) {
      agg.costSum += r.costUsd;
      agg.costSamples += 1;
    }
    byKey.set(key, agg);
  }
  return [...byKey.values()];
}

export async function chooseModel(taskSetName: string = GROUNDING_TASK_SET, opts: { lookbackResults?: number } = {}): Promise<ModelChoice> {
  const lookbackResults = opts.lookbackResults ?? 200;
  const aggregates = await aggregate(taskSetName, lookbackResults);
  const eligible = aggregates.filter((a) => a.total >= MIN_SAMPLES);

  if (eligible.length === 0) {
    return {
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      reason: "Aucune évaluation persistée pour ce jeu de tâches — repli explicite vers le modèle par défaut.",
    };
  }

  const withPassRate = eligible.map((a) => ({
    ...a,
    passRate: a.passed / a.total,
    avgCost: a.costSamples > 0 ? a.costSum / a.costSamples : null,
  }));

  const bestPassRate = Math.max(...withPassRate.map((a) => a.passRate));
  const tiedOnPassRate = withPassRate.filter((a) => a.passRate === bestPassRate);

  // Repli parmi les ex-æquo : coût moyen connu le plus bas ; si aucun n'a de
  // coût connu, garder le premier (ordre stable, jamais un choix aléatoire).
  const withKnownCost = tiedOnPassRate.filter((a) => a.avgCost != null);
  const winner =
    withKnownCost.length > 0
      ? withKnownCost.reduce((best, a) => (a.avgCost! < best.avgCost! ? a : best))
      : tiedOnPassRate[0];

  if (!winner) {
    return { provider: DEFAULT_PROVIDER, model: DEFAULT_MODEL, reason: "État inattendu (aucun candidat) — repli vers le modèle par défaut." };
  }

  return {
    provider: winner.provider,
    model: winner.model,
    reason: `Taux de réussite ${(winner.passRate * 100).toFixed(0)}% sur ${winner.total} résultat(s) réel(s) persisté(s)${
      winner.avgCost != null ? `, coût moyen ${winner.avgCost.toFixed(6)}$/appel` : ""
    }.`,
  };
}

function instantiateProvider(providerName: string): ModelProvider | null {
  if (providerName === "anthropic") return new AnthropicProvider();
  if (providerName === "openai") return new OpenAiProvider();
  return null; // provider inconnu — jamais fabriqué, simplement écarté (aucun ModelProvider disponible sous ce nom aujourd'hui)
}

/**
 * ONDEAL AI CORE — §18/§24 "Model Console écrivable + failover capability-aware"
 * (06/09/2026), clôture réelle.
 *
 * Construit la liste ORDONNÉE de candidats {provider, model} pour un
 * FailoverProvider, à partir de deux sources RÉELLES, jamais inventées :
 *
 *   1. ModelConfig (table écrite par l'Owner via le Model Console — voir
 *      /api/ai-lab/models/*). Si au moins une ligne enabled=true existe,
 *      elle est AUTORITATIVE : l'Owner a explicitement configuré son
 *      routage, on le respecte à la lettre (providerPriority croissant),
 *      jamais remplacé silencieusement par une heuristique du Router.
 *      `forceForTestUntil` dans le futur prend le pas sur tout le reste —
 *      UNE SEULE ligne forcée à la fois (§18 "force-for-test").
 *   2. Sinon (aucune configuration Owner encore écrite — état par défaut du
 *      système) : repli sur `chooseModel()` (heuristique d'évaluation
 *      existante, PHASE 2) pour le premier candidat Anthropic, complété par
 *      un second candidat OpenAI SI ET SEULEMENT SI OPENAI_API_KEY est
 *      configurée (sinon l'ajouter serait un candidat qui échoue à 100% du
 *      temps — pas un vrai failover, du bruit). C'est ce qui rend le système
 *      "provider-independent" par défaut dès que l'Owner fournit la
 *      deuxième clé, sans même toucher le Model Console.
 */
export async function resolveFailoverCandidates(taskSetName: string = GROUNDING_TASK_SET): Promise<FailoverCandidate[]> {
  const configs = await prisma.modelConfig.findMany({ where: { enabled: true }, orderBy: { providerPriority: "asc" } });

  const forced = configs.find((c) => c.forceForTestUntil && c.forceForTestUntil.getTime() > Date.now());
  const ordered = forced ? [forced] : configs;

  if (ordered.length > 0) {
    const candidates: FailoverCandidate[] = [];
    for (const cfg of ordered) {
      const provider = instantiateProvider(cfg.provider);
      if (!provider) continue;
      candidates.push({ provider, model: cfg.model, maxCostPerCallUsd: cfg.maxCostPerCallUsd });
    }
    if (candidates.length > 0) return candidates;
    // Toutes les lignes activées référencent un provider inconnu — état de config invalide, jamais silencieux : repli explicite ci-dessous plutôt qu'une liste vide qui ferait échouer FailoverProvider à la construction.
  }

  const choice = await chooseModel(taskSetName);
  const defaultCandidates: FailoverCandidate[] = [{ provider: new AnthropicProvider(), model: choice.model }];
  if (process.env.OPENAI_API_KEY) {
    defaultCandidates.push({ provider: new OpenAiProvider(), model: "gpt-4o-mini" });
  }
  return defaultCandidates;
}
