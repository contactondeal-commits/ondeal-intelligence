import type { MarginAnalysis, Nullable } from "@/types";

export interface MarginInput {
  productId: string;
  variantId: string;
  title: string;
  sellingPrice: Nullable<number>;
  supplierCost: Nullable<number>;
  shippingCost: Nullable<number>;
  paymentFeesRate: Nullable<number>; // ex 0.029
  otherFixedCost: Nullable<number>;
  /**
   * Provenance du coût fournisseur (voir costs.ts). Optionnelle pour rester
   * compatible avec les appels existants : absente, un coût fourni est
   * considéré comme une hypothèse OnDeal (comportement historique), jamais
   * comme un coût Shopify réel.
   */
  supplierCostSource?: "shopify_unit_cost" | "cost_assumption" | "unavailable";
}

/**
 * Calcule marge et taux de marge (PHASE 8). Chaque hypothèse manquante est
 * listée dans `missingAssumptions` et fait retomber `margin`/`marginRate` à
 * `null` plutôt que de supposer un coût à 0 (ce qui gonflerait faussement la
 * marge affichée).
 *
 * Vertical slice 03/09/2026 : ajoute la MARGE BRUTE (prix − coût
 * fournisseur, avant transport et frais), calculable dès que le coût réel
 * Shopify est connu, et le statut REAL / CALCULATED / ESTIMATED /
 * UNAVAILABLE de chaque valeur. Même fonction, mêmes formules : ANALYSE =
 * SIMULATION reste garanti.
 */
export function analyzeMargin(input: MarginInput): MarginAnalysis {
  const missing: string[] = [];
  if (input.sellingPrice === null) missing.push("sellingPrice");
  if (input.supplierCost === null) missing.push("supplierCost");
  if (input.shippingCost === null) missing.push("shippingCost");
  if (input.paymentFeesRate === null) missing.push("paymentFeesRate");
  // otherFixedCost est optionnel : son absence n'empêche pas le calcul,
  // mais on la mentionne pour transparence si un vrai montant existe ailleurs.

  const paymentFees =
    input.sellingPrice !== null && input.paymentFeesRate !== null
      ? input.sellingPrice * input.paymentFeesRate
      : null;

  const canCompute =
    input.sellingPrice !== null &&
    input.supplierCost !== null &&
    input.shippingCost !== null &&
    paymentFees !== null;

  const otherFixedCost = input.otherFixedCost ?? 0;

  const totalCost = canCompute
    ? (input.supplierCost as number) + (input.shippingCost as number) + (paymentFees as number) + otherFixedCost
    : null;

  const margin = canCompute && totalCost !== null ? (input.sellingPrice as number) - totalCost : null;
  const marginRate =
    margin !== null && input.sellingPrice !== null && input.sellingPrice > 0
      ? margin / input.sellingPrice
      : null;

  // Marge brute : prix − coût fournisseur, sans aucune hypothèse.
  const grossMargin =
    input.sellingPrice !== null && input.supplierCost !== null ? input.sellingPrice - input.supplierCost : null;
  const grossMarginRate =
    grossMargin !== null && input.sellingPrice !== null && input.sellingPrice > 0 ? grossMargin / input.sellingPrice : null;

  const supplierCostSource =
    input.supplierCostSource ?? (input.supplierCost !== null ? "cost_assumption" : "unavailable");

  return {
    productId: input.productId,
    variantId: input.variantId,
    title: input.title,
    sellingPrice: input.sellingPrice,
    supplierCost: input.supplierCost,
    shippingCost: input.shippingCost,
    paymentFees,
    otherFixedCost: input.otherFixedCost,
    totalCost,
    margin,
    marginRate,
    missingAssumptions: missing,
    grossMargin,
    grossMarginRate,
    supplierCostSource,
    status: {
      sellingPrice: input.sellingPrice !== null ? "real" : "unavailable",
      supplierCost:
        input.supplierCost === null ? "unavailable" : supplierCostSource === "shopify_unit_cost" ? "real" : "estimated",
      shippingCost: input.shippingCost !== null ? "estimated" : "unavailable",
      paymentFees: paymentFees !== null ? "estimated" : "unavailable",
      grossMargin: grossMargin !== null ? "calculated" : "unavailable",
      margin: margin !== null ? "calculated" : "unavailable",
    },
  };
}

export function summarizeGrossMargin(analyses: MarginAnalysis[]) {
  const computed = analyses.filter((a) => a.grossMarginRate !== null);
  return {
    total: analyses.length,
    withRealCost: analyses.filter((a) => a.supplierCostSource === "shopify_unit_cost").length,
    withFallbackCost: analyses.filter((a) => a.supplierCostSource === "cost_assumption").length,
    withoutCost: analyses.filter((a) => a.supplierCostSource === "unavailable").length,
    grossNegative: computed.filter((a) => (a.grossMargin as number) < 0).length,
    grossFaible: computed.filter((a) => (a.grossMarginRate as number) >= 0 && (a.grossMarginRate as number) < MARGIN_THRESHOLDS.faibleRate).length,
    averageGrossRate: computed.length > 0 ? computed.reduce((s, a) => s + (a.grossMarginRate as number), 0) / computed.length : null,
  };
}

// Seuils explicables utilisés par le moteur de recommandations.
export const MARGIN_THRESHOLDS = {
  faibleRate: 0.15, // < 15% = marge faible
  fortRate: 0.4, // >= 40% = forte marge (opportunité)
} as const;

export function summarizeMargin(analyses: MarginAnalysis[]) {
  const computed = analyses.filter((a) => a.marginRate !== null);
  return {
    total: analyses.length,
    withData: computed.length,
    negative: computed.filter((a) => (a.margin as number) < 0).length,
    faible: computed.filter(
      (a) => (a.marginRate as number) >= 0 && (a.marginRate as number) < MARGIN_THRESHOLDS.faibleRate,
    ).length,
    forte: computed.filter((a) => (a.marginRate as number) >= MARGIN_THRESHOLDS.fortRate).length,
    averageRate:
      computed.length > 0
        ? computed.reduce((sum, a) => sum + (a.marginRate as number), 0) / computed.length
        : null,
  };
}
