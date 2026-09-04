import { simulatePriceChange } from "@/lib/intelligence/simulate";
import type { ResolvedCostInputs } from "@/lib/intelligence/costs";

/**
 * PREDICTION SNAPSHOT → RESULT → GAP — structure minimale de mesure du
 * vertical slice « marge réelle par variante » (03/09/2026).
 *
 * `buildPricePrediction` persiste, au moment de la VALIDATION HUMAINE,
 * exactement ce qu'OnDeal prédit (mêmes formules que l'analyse, via
 * `simulatePriceChange` — jamais une formule séparée) : prix avant, coût et
 * sa source, marge brute et complète avant/après, deltas, hypothèses
 * utilisées et horodatage. Cela répond à « qu'est-ce qu'OnDeal pensait qu'il
 * allait se passer avant l'action ? ».
 *
 * `measurePriceOutcome` compare, juste après la mutation Shopify vérifiée,
 * le résultat STRUCTUREL réellement observé (prix appliqué relu de Shopify,
 * coût réel au moment de l'exécution) à la prédiction. C'est une mesure
 * comptable, pas une mesure commerciale : les effets sur les ventes
 * relèvent de `assessDeferredMeasurement`, qui n'affirme rien tant que le
 * volume n'est pas statistiquement exploitable.
 *
 * Aucun apprentissage ici — seulement l'enregistrement fidèle des trois
 * termes PRÉDICTION / RÉSULTAT / ÉCART.
 */

export interface PricePrediction {
  kind: "price";
  version: 1;
  variantId: string;
  productId: string;
  /** Horodatage de la prédiction = moment de la validation humaine. */
  predictedAt: string;
  priceBefore: number | null;
  newPrice: number;
  supplierCost: number | null;
  supplierCostSource: ResolvedCostInputs["supplierCostSource"];
  assumptions: {
    shippingCost: number | null;
    shippingCostSource: ResolvedCostInputs["shippingCostSource"];
    paymentFeesRate: number | null;
    paymentFeesRateSource: ResolvedCostInputs["paymentFeesRateSource"];
    otherFixedCost: number | null;
  };
  /** Marge brute = prix − coût fournisseur (avant transport et frais). */
  grossMarginBefore: number | null;
  grossMarginRateBefore: number | null;
  grossMarginAfter: number | null;
  grossMarginRateAfter: number | null;
  /** Marge complète (requiert les hypothèses) — null si non calculable. */
  marginBefore: number | null;
  marginRateBefore: number | null;
  marginAfter: number | null;
  marginRateAfter: number | null;
  deltaPrice: number;
  deltaPricePct: number | null;
  deltaGrossMargin: number | null;
  deltaGrossMarginPct: number | null;
  deltaMargin: number | null;
  /** Ce que la prédiction NE couvre PAS — explicite, jamais implicite. */
  notPredicted: string[];
}

export function buildPricePrediction(input: {
  variantId: string;
  productId: string;
  title?: string;
  currentPrice: number | null;
  newPrice: number;
  costs: ResolvedCostInputs;
  now?: Date;
}): PricePrediction {
  const sim = simulatePriceChange({
    productId: input.productId,
    variantId: input.variantId,
    title: input.title ?? "",
    currentPrice: input.currentPrice,
    supplierCost: input.costs.supplierCost,
    shippingCost: input.costs.shippingCost,
    paymentFeesRate: input.costs.paymentFeesRate,
    otherFixedCost: input.costs.otherFixedCost,
    candidatePrice: input.newPrice,
    supplierCostSource: input.costs.supplierCostSource,
  });
  const before = sim.available ? sim.before : null;
  const after = sim.available ? sim.after : null;

  // Marge brute : calculable même si la simulation complète ne l'est pas
  // (hypothèses manquantes) — mêmes définitions que analyzeMargin.
  const cost = input.costs.supplierCost;
  const grossBefore = input.currentPrice !== null && cost !== null ? input.currentPrice - cost : null;
  const grossAfter = cost !== null ? input.newPrice - cost : null;
  const grossRateBefore = grossBefore !== null && input.currentPrice !== null && input.currentPrice > 0 ? grossBefore / input.currentPrice : null;
  const grossRateAfter = grossAfter !== null && input.newPrice > 0 ? grossAfter / input.newPrice : null;

  const deltaPrice = input.currentPrice !== null ? input.newPrice - input.currentPrice : input.newPrice;
  const deltaGross = grossBefore !== null && grossAfter !== null ? grossAfter - grossBefore : null;

  const notPredicted = [
    "volume de ventes après changement de prix (aucun modèle de demande : simulation comptable, pas comportementale)",
    "chiffre d'affaires et marge réalisée (dépendent des ventes réelles)",
  ];
  const fullMarginPredicted = sim.available && sim.fullMarginAvailable;
  if (!fullMarginPredicted) {
    notPredicted.push("marge complète (transport et/ou frais de paiement non renseignés)");
  }

  return {
    kind: "price",
    version: 1,
    variantId: input.variantId,
    productId: input.productId,
    predictedAt: (input.now ?? new Date()).toISOString(),
    priceBefore: input.currentPrice,
    newPrice: input.newPrice,
    supplierCost: cost,
    supplierCostSource: input.costs.supplierCostSource,
    assumptions: {
      shippingCost: input.costs.shippingCost,
      shippingCostSource: input.costs.shippingCostSource,
      paymentFeesRate: input.costs.paymentFeesRate,
      paymentFeesRateSource: input.costs.paymentFeesRateSource,
      otherFixedCost: input.costs.otherFixedCost,
    },
    grossMarginBefore: grossBefore,
    grossMarginRateBefore: grossRateBefore,
    grossMarginAfter: grossAfter,
    grossMarginRateAfter: grossRateAfter,
    marginBefore: before?.margin ?? null,
    marginRateBefore: before?.marginRate ?? null,
    marginAfter: after?.margin ?? null,
    marginRateAfter: after?.marginRate ?? null,
    deltaPrice,
    deltaPricePct: input.currentPrice !== null && input.currentPrice > 0 ? deltaPrice / input.currentPrice : null,
    deltaGrossMargin: deltaGross,
    deltaGrossMarginPct: deltaGross !== null && grossBefore !== null && grossBefore !== 0 ? deltaGross / Math.abs(grossBefore) : null,
    deltaMargin: fullMarginPredicted ? sim.deltaMargin : null,
    notPredicted,
  };
}

export function isPricePrediction(value: unknown): value is PricePrediction {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return v.kind === "price" && typeof v.variantId === "string" && typeof v.newPrice === "number" && typeof v.predictedAt === "string";
}

/** RÉSULTAT structurel observé juste après la mutation + ÉCART avec la prédiction. */
export interface PriceOutcomeMeasurement {
  kind: "price_structural";
  measuredAt: string;
  observed: {
    /** Prix relu de Shopify après la mutation (jamais la valeur envoyée). */
    appliedPrice: number;
    supplierCost: number | null;
    supplierCostSource: ResolvedCostInputs["supplierCostSource"];
    grossMargin: number | null;
    grossMarginRate: number | null;
  };
  predicted: {
    newPrice: number;
    grossMarginAfter: number | null;
    grossMarginRateAfter: number | null;
    marginAfter: number | null;
  };
  gap: {
    price: number;
    grossMargin: number | null;
    /** true si prix, coût et marge brute observés correspondent à la prédiction (tolérance 1 centime). */
    structuralMatch: boolean;
    explanation: string;
  };
  /** Mesure COMMERCIALE différée — jamais inventée. */
  deferred: DeferredMeasurement;
}

export interface DeferredMeasurement {
  status: "insufficient_data" | "available";
  /** Fenêtres d'observation en jours, identiques avant/après. */
  windowDays: number;
  unitsBefore: number | null;
  unitsAfter: number | null;
  /** Seuil minimal d'unités vendues dans CHAQUE fenêtre pour prétendre comparer. */
  minUnitsPerWindow: number;
  reason: string;
}

export const DEFERRED_WINDOW_DAYS = 14;
export const DEFERRED_MIN_UNITS_PER_WINDOW = 30;

export function measurePriceOutcome(input: {
  prediction: PricePrediction;
  appliedPrice: number;
  supplierCost: number | null;
  supplierCostSource: ResolvedCostInputs["supplierCostSource"];
  now?: Date;
}): PriceOutcomeMeasurement {
  const cost = input.supplierCost;
  const gross = cost !== null ? input.appliedPrice - cost : null;
  const grossRate = gross !== null && input.appliedPrice > 0 ? gross / input.appliedPrice : null;
  const priceGap = input.appliedPrice - input.prediction.newPrice;
  const grossGap = gross !== null && input.prediction.grossMarginAfter !== null ? gross - input.prediction.grossMarginAfter : null;
  const structuralMatch = Math.abs(priceGap) <= 0.01 && (grossGap === null || Math.abs(grossGap) <= 0.01);

  const parts: string[] = [];
  if (Math.abs(priceGap) > 0.01) parts.push(`prix appliqué ${input.appliedPrice.toFixed(2)} € au lieu de ${input.prediction.newPrice.toFixed(2)} € prédit`);
  if (grossGap !== null && Math.abs(grossGap) > 0.01) parts.push(`marge brute observée ${gross!.toFixed(2)} € au lieu de ${input.prediction.grossMarginAfter!.toFixed(2)} € prédit (coût réel a changé)`);
  if (gross === null) parts.push("marge brute observée non calculable (coût indisponible à l'exécution)");

  return {
    kind: "price_structural",
    measuredAt: (input.now ?? new Date()).toISOString(),
    observed: { appliedPrice: input.appliedPrice, supplierCost: cost, supplierCostSource: input.supplierCostSource, grossMargin: gross, grossMarginRate: grossRate },
    predicted: {
      newPrice: input.prediction.newPrice,
      grossMarginAfter: input.prediction.grossMarginAfter,
      grossMarginRateAfter: input.prediction.grossMarginRateAfter,
      marginAfter: input.prediction.marginAfter,
    },
    gap: {
      price: priceGap,
      grossMargin: grossGap,
      structuralMatch,
      explanation: parts.length === 0 ? "Résultat structurel conforme à la prédiction (prix et marge brute)." : parts.join(" ; "),
    },
    deferred: assessDeferredMeasurement({ unitsBefore: null, unitsAfter: null, windowDays: DEFERRED_WINDOW_DAYS }),
  };
}

/**
 * Mesure commerciale différée : compare les unités vendues de la variante sur
 * une fenêtre AVANT et une fenêtre APRÈS l'action. Tant que l'une des deux
 * fenêtres n'atteint pas le seuil minimal, le statut reste
 * `insufficient_data` — jamais une tendance affichée sur 1 ou 2 ventes.
 */
export function assessDeferredMeasurement(input: {
  unitsBefore: number | null;
  unitsAfter: number | null;
  windowDays?: number;
  minUnitsPerWindow?: number;
}): DeferredMeasurement {
  const windowDays = input.windowDays ?? DEFERRED_WINDOW_DAYS;
  const min = input.minUnitsPerWindow ?? DEFERRED_MIN_UNITS_PER_WINDOW;
  const before = input.unitsBefore;
  const after = input.unitsAfter;
  const enough = before !== null && after !== null && before >= min && after >= min;
  return {
    status: enough ? "available" : "insufficient_data",
    windowDays,
    unitsBefore: before,
    unitsAfter: after,
    minUnitsPerWindow: min,
    reason: enough
      ? `Au moins ${min} unités vendues dans chacune des deux fenêtres de ${windowDays} jours.`
      : `Données insuffisantes : il faut au moins ${min} unités vendues dans chacune des fenêtres de ${windowDays} jours avant et après l'action pour comparer (observé : ${before ?? "—"} avant, ${after ?? "—"} après).`,
  };
}
