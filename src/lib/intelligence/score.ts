import type { ScoreBreakdown, ScoreFactor } from "@/types";

/**
 * ONDEAL SCORE (PHASE 5) — score produit explicable de 0 à 100.
 *
 * Principe : chaque facteur a un poids fixe (somme = 100). Si la donnée
 * source d'un facteur est indisponible, ce facteur est exclu du calcul et
 * son poids est redistribué proportionnellement aux facteurs disponibles —
 * jamais compté comme 0 (ce qui pénaliserait injustement un produit neuf
 * sans historique) ni ignoré silencieusement (dataCompleteness l'expose).
 */

export interface ScoreInputs {
  // Ventes — évolution normalisée -100..+100 (%), null si pas d'historique comparatif
  salesTrend: number | null;
  // Marge — taux 0..1, null si hypothèses de coût manquantes
  marginRate: number | null;
  // Stock — 0 (rupture) à 100 (stock normal bien dimensionné), null si stock inconnu
  stockHealth: number | null;
  // Avis — note moyenne 1..5, null si aucun avis
  averageRating: number | null;
  // Avis — volume d'avis, utilisé pour pondérer la confiance de la note
  reviewCount: number;
  // Contenu fiche produit — 0..100, évalué depuis des critères objectifs
  // (présence description, image, poids/dimensions) — jamais estimé au jugé.
  contentQuality: number | null;
}

interface FactorDef {
  key: string;
  label: string;
  weight: number;
  compute: (i: ScoreInputs) => number | null; // retourne 0-100 normalisé, ou null si indisponible
}

const FACTORS: FactorDef[] = [
  {
    key: "sales_trend",
    label: "Évolution des ventes",
    weight: 25,
    compute: (i) => (i.salesTrend === null ? null : clamp((i.salesTrend + 100) / 2, 0, 100)),
  },
  {
    key: "margin",
    label: "Marge",
    weight: 20,
    compute: (i) => (i.marginRate === null ? null : clamp(i.marginRate * 200, 0, 100)), // 50% marge = 100 pts
  },
  {
    key: "stock_health",
    label: "Santé du stock",
    weight: 15,
    compute: (i) => (i.stockHealth === null ? null : clamp(i.stockHealth, 0, 100)),
  },
  {
    key: "rating",
    label: "Note moyenne",
    weight: 20,
    compute: (i) => {
      if (i.averageRating === null) return null;
      // Confiance réduite si très peu d'avis : on ne masque pas la note,
      // mais on ne la laisse pas non plus peser à 100% sur un seul avis.
      const confidenceFactor = clamp(i.reviewCount / 10, 0.3, 1);
      const base = clamp(((i.averageRating - 1) / 4) * 100, 0, 100);
      return base * confidenceFactor + 50 * (1 - confidenceFactor);
    },
  },
  {
    key: "content_quality",
    label: "Qualité de la fiche produit",
    weight: 10,
    compute: (i) => (i.contentQuality === null ? null : clamp(i.contentQuality, 0, 100)),
  },
  {
    key: "review_volume",
    label: "Volume d'avis",
    weight: 10,
    compute: (i) => clamp((i.reviewCount / 25) * 100, 0, 100), // toujours calculable (0 avis = 0 pt, jamais null)
  },
];

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function computeScore(inputs: ScoreInputs): ScoreBreakdown {
  const evaluated = FACTORS.map((f) => {
    const normalized = f.compute(inputs);
    return { def: f, normalized };
  });

  const availableWeightSum = evaluated
    .filter((e) => e.normalized !== null)
    .reduce((sum, e) => sum + e.def.weight, 0);

  const factors: ScoreFactor[] = evaluated.map(({ def, normalized }) => {
    const available = normalized !== null;
    // Redistribution proportionnelle du poids des facteurs indisponibles.
    const effectiveWeight =
      available && availableWeightSum > 0 ? def.weight / availableWeightSum : 0;
    const contribution = available ? (normalized as number) * effectiveWeight : 0;
    return {
      key: def.key,
      label: def.label,
      weight: def.weight / 100,
      rawValue: rawValueFor(def.key, inputs),
      normalizedValue: normalized,
      contribution,
      available,
    };
  });

  const score = Math.round(factors.reduce((sum, f) => sum + f.contribution, 0));
  const dataCompleteness = Math.round(
    (evaluated.filter((e) => e.normalized !== null).length / FACTORS.length) * 100,
  );

  return { score: clamp(score, 0, 100), factors, dataCompleteness };
}

function rawValueFor(key: string, i: ScoreInputs): number | null {
  switch (key) {
    case "sales_trend":
      return i.salesTrend;
    case "margin":
      return i.marginRate;
    case "stock_health":
      return i.stockHealth;
    case "rating":
      return i.averageRating;
    case "content_quality":
      return i.contentQuality;
    case "review_volume":
      return i.reviewCount;
    default:
      return null;
  }
}

export type ProductTierResult = "a_booster" | "performant" | "a_optimiser" | "a_surveiller" | "a_revoir";

/**
 * Classement produit (PHASE 9) : combine le score ET des signaux distincts
 * (rupture/marge négative) pour éviter qu'un bon score masque un problème
 * urgent — un produit en rupture n'est jamais classé "performant".
 */
export function classifyProduct(params: {
  score: number;
  hasStockCritical: boolean; // rupture ou rupture imminente
  hasNegativeMargin: boolean;
  salesTrendPositive: boolean | null;
}): ProductTierResult {
  if (params.hasNegativeMargin || params.hasStockCritical) return "a_revoir";
  if (params.score >= 80 && params.salesTrendPositive) return "a_booster";
  if (params.score >= 70) return "performant";
  if (params.score >= 50) return "a_optimiser";
  if (params.score >= 30) return "a_surveiller";
  return "a_revoir";
}
