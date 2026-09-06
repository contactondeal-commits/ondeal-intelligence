import { prisma } from "@/lib/db";

/**
 * ONDEAL AI CORE — FINAL PHASE : Outcome/ROI Engine (06/09/2026).
 *
 * §"Outcome/ROI Engine" du mandat final — jusqu'ici totalement absent
 * (aucune trace dans le dépôt avant ce fichier). Principe identique à
 * chaque autre sous-système de cette fondation (§"NO CAPABILITY THEATER") :
 * chaque métrique ci-dessous est calculée à la volée depuis les tables
 * RÉELLEMENT écrites par les autres sous-systèmes (StorefrontMission,
 * EvolutionProposal, ExperimentRun/Variant) — jamais une valeur inventée,
 * jamais un nombre codé en dur. Un dénominateur nul retourne `null`
 * (jamais un taux fabriqué du type "0%" qui suggérerait une mesure réelle
 * là où il n'y a simplement aucune donnée encore).
 *
 * Volontairement SANS nouvelle table Prisma : une vue calculée reste
 * toujours fraîche (jamais de staleness à gérer) et ne prend aucun risque
 * de migration pour un besoin de LECTURE pure — cohérent avec le principe
 * déjà écrit ailleurs dans cette fondation ("n'ajouter une table que le
 * jour où un appelant réel a besoin d'écrire un état, pas seulement de le
 * lire").
 */

export interface OutcomeSummary {
  missions: {
    total: number;
    byStatus: Record<string, number>;
    totalCostUsd: number;
    avgCostUsd: number | null;
    successRatePct: number | null; // SUCCEEDED / (SUCCEEDED + FAILED + CANCELLED) — les missions encore PLANNING/RUNNING/PAUSED sont exclues du dénominateur (pas encore un résultat)
  };
  evolution: {
    total: number;
    byStatus: Record<string, number>;
    shippedCount: number;
    shipRatePct: number | null; // SHIPPED / (APPROVED + REJECTED + SHIPPED) — décisions Owner déjà tranchées uniquement
    realShippedPrUrls: string[]; // preuve vérifiable — jamais juste un compteur opaque
  };
  experiments: {
    total: number;
    completed: number;
    winRatePct: null; // §"win rate" n'a de sens qu'avec un baseline/contrôle explicite par expérience — pas encore un champ structuré (ExperimentVariant n'a pas de flag isControl) ; documenté ici comme un écart honnête plutôt qu'un taux inventé
    avgCostPerExperimentUsd: number | null;
    avgWinnerScore: number | null;
  };
  generatedAt: string;
}

function ratio(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10; // 1 décimale
}

export async function computeOutcomeSummary(): Promise<OutcomeSummary> {
  const [missionsByStatus, missionCostAgg, evolutionByStatus, shippedProposals, experiments] = await Promise.all([
    prisma.storefrontMission.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.storefrontMission.aggregate({ _sum: { totalCostUsd: true }, _avg: { totalCostUsd: true }, _count: { _all: true } }),
    prisma.evolutionProposal.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.evolutionProposal.findMany({ where: { status: "SHIPPED" }, select: { shippedPrUrl: true }, take: 500 }),
    prisma.experimentRun.findMany({
      select: {
        status: true,
        winnerVariantId: true,
        variants: { select: { id: true, costUsd: true, score: true } },
      },
      take: 1000,
    }),
  ]);

  const missionStatusMap: Record<string, number> = {};
  for (const row of missionsByStatus) missionStatusMap[row.status] = row._count._all;
  const missionSucceeded = missionStatusMap["SUCCEEDED"] ?? 0;
  const missionFailed = missionStatusMap["FAILED"] ?? 0;
  const missionCancelled = missionStatusMap["CANCELLED"] ?? 0;
  const missionTerminalTotal = missionSucceeded + missionFailed + missionCancelled;

  const evoStatusMap: Record<string, number> = {};
  for (const row of evolutionByStatus) evoStatusMap[row.status] = row._count._all;
  const evoApproved = evoStatusMap["APPROVED"] ?? 0;
  const evoRejected = evoStatusMap["REJECTED"] ?? 0;
  const evoShipped = evoStatusMap["SHIPPED"] ?? 0;
  const evoDecidedTotal = evoApproved + evoRejected + evoShipped;

  const completedExperiments = experiments.filter((e) => e.status === "COMPLETED");
  const allVariantCosts = experiments.flatMap((e) => e.variants.map((v) => v.costUsd).filter((c): c is number => typeof c === "number"));
  const experimentCosts = experiments.map((e) => e.variants.reduce((sum, v) => sum + (v.costUsd ?? 0), 0));
  const winnerScores = completedExperiments
    .map((e) => {
      const winner = e.variants.find((v) => v.id === e.winnerVariantId);
      return winner?.score ?? null;
    })
    .filter((s): s is number => typeof s === "number");

  return {
    missions: {
      total: missionCostAgg._count._all,
      byStatus: missionStatusMap,
      totalCostUsd: Math.round((missionCostAgg._sum.totalCostUsd ?? 0) * 100) / 100,
      avgCostUsd: missionCostAgg._avg.totalCostUsd != null ? Math.round(missionCostAgg._avg.totalCostUsd * 100) / 100 : null,
      successRatePct: ratio(missionSucceeded, missionTerminalTotal),
    },
    evolution: {
      total: Object.values(evoStatusMap).reduce((a, b) => a + b, 0),
      byStatus: evoStatusMap,
      shippedCount: evoShipped,
      shipRatePct: ratio(evoShipped, evoDecidedTotal),
      realShippedPrUrls: shippedProposals.map((p) => p.shippedPrUrl).filter((u): u is string => !!u),
    },
    experiments: {
      total: experiments.length,
      completed: completedExperiments.length,
      winRatePct: null,
      avgCostPerExperimentUsd:
        experimentCosts.length > 0 ? Math.round((experimentCosts.reduce((a, b) => a + b, 0) / experimentCosts.length) * 10000) / 10000 : allVariantCosts.length > 0 ? null : null,
      avgWinnerScore: winnerScores.length > 0 ? Math.round((winnerScores.reduce((a, b) => a + b, 0) / winnerScores.length) * 100) / 100 : null,
    },
    generatedAt: new Date().toISOString(),
  };
}
