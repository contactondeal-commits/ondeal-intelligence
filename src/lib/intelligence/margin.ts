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
}

/**
 * Calcule marge et taux de marge (PHASE 8). Chaque hypothèse manquante est
 * listée dans `missingAssumptions` et fait retomber `margin`/`marginRate` à
 * `null` plutôt que de supposer un coût à 0 (ce qui gonflerait faussement la
 * marge affichée).
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
