import { analyzeMargin } from "@/lib/intelligence/margin";
import { analyzeStock } from "@/lib/intelligence/stock";
import type { MarginAnalysis, StockStatus } from "@/types";

/**
 * Simulation — étape "et si ?" entre Décision et Action. Ne recalcule
 * JAMAIS avec une formule inédite : réutilise exactement les mêmes fonctions
 * pures que les modules Marge/Stock déjà validés (`analyzeMargin`), pour que
 * "simuler" et "ce qui sera réellement vrai après l'action" restent
 * garantis identiques. Quand une hypothèse manque, la simulation est
 * explicitement indisponible — jamais un nombre approché à sa place.
 */

export interface PriceSimulationInput {
  productId: string;
  variantId: string;
  title: string;
  currentPrice: number | null;
  supplierCost: number | null;
  shippingCost: number | null;
  paymentFeesRate: number | null;
  otherFixedCost: number | null;
  candidatePrice: number;
  /** Provenance du coût fournisseur (costs.ts) — transmise telle quelle à analyzeMargin. */
  supplierCostSource?: "shopify_unit_cost" | "cost_assumption" | "unavailable";
}

export type PriceSimulationResult =
  | {
      available: true;
      before: MarginAnalysis;
      after: MarginAnalysis;
      /** Delta de marge COMPLÈTE (null si transport/frais non renseignés). */
      deltaMargin: number | null;
      deltaMarginRate: number | null;
      /** Delta de MARGE BRUTE (prix − coût fournisseur) — toujours calculable quand le coût est connu. */
      deltaGrossMargin: number;
      deltaGrossMarginRate: number | null;
      /** false = seule la marge brute est simulable ; `fullMarginUnavailableReason` explique quelle hypothèse manque. */
      fullMarginAvailable: boolean;
      fullMarginUnavailableReason: string | null;
    }
  | { available: false; reason: string };

export function simulatePriceChange(input: PriceSimulationInput): PriceSimulationResult {
  if (!Number.isFinite(input.candidatePrice) || input.candidatePrice <= 0) {
    return { available: false, reason: "Indiquez un prix candidat valide (supérieur à 0)." };
  }

  const baseInput = {
    productId: input.productId,
    variantId: input.variantId,
    title: input.title,
    supplierCost: input.supplierCost,
    shippingCost: input.shippingCost,
    paymentFeesRate: input.paymentFeesRate,
    otherFixedCost: input.otherFixedCost,
    supplierCostSource: input.supplierCostSource,
  };

  const before = analyzeMargin({ ...baseInput, sellingPrice: input.currentPrice });
  const after = analyzeMargin({ ...baseInput, sellingPrice: input.candidatePrice });

  // Sans coût fournisseur (ni réel Shopify, ni hypothèse), rien n'est
  // simulable — jamais un coût supposé à 0.
  if (after.grossMargin === null || before.grossMargin === null) {
    const missing = after.missingAssumptions.filter((m) => m !== "sellingPrice");
    return {
      available: false,
      reason:
        missing.length > 0
          ? `Simulation impossible : hypothèse(s) de coût manquante(s) (${missing.join(", ")}). Renseignez-les dans Prix & Marge pour simuler.`
          : "Simulation impossible avec les données actuelles.",
    };
  }

  // Marge complète : seulement si transport et frais sont renseignés.
  // Sinon la simulation reste disponible sur la MARGE BRUTE, en le disant.
  const fullMarginAvailable = after.margin !== null && before.margin !== null;
  const missingForFull = after.missingAssumptions.filter((m) => m !== "sellingPrice" && m !== "supplierCost");

  return {
    available: true,
    before,
    after,
    deltaMargin: fullMarginAvailable ? (after.margin as number) - (before.margin as number) : null,
    deltaMarginRate:
      before.marginRate !== null && after.marginRate !== null ? after.marginRate - before.marginRate : null,
    deltaGrossMargin: after.grossMargin - before.grossMargin,
    deltaGrossMarginRate:
      before.grossMarginRate !== null && after.grossMarginRate !== null ? after.grossMarginRate - before.grossMarginRate : null,
    fullMarginAvailable,
    fullMarginUnavailableReason: fullMarginAvailable
      ? null
      : `Marge complète non calculable : ${missingForFull.map(assumptionLabel).join(", ")} non renseigné(s) — seule la marge brute (prix − coût fournisseur) est simulée.`,
  };
}

function assumptionLabel(key: string): string {
  switch (key) {
    case "shippingCost":
      return "transport";
    case "paymentFeesRate":
      return "frais de paiement";
    default:
      return key;
  }
}

export interface RestockSimulationInput {
  productId?: string;
  variantId?: string;
  title?: string;
  sku?: string | null;
  currentStock: number | null;
  dailyVelocity: number | null;
  candidateAddedUnits: number;
}

export type RestockSimulationResult =
  | { available: true; projectedStock: number; projectedDaysOfStock: number | null; projectedStatus: StockStatus }
  | { available: false; reason: string };

/**
 * Simule un réapprovisionnement — réutilise `analyzeStock` (mêmes seuils,
 * même formule jours-de-stock) pour l'état "après" au lieu d'une formule de
 * projection indépendante : ANALYSE = SIMULATION = MÊME VÉRITÉ MÉTIER. Si
 * une donnée manque, elle est signalée explicitement, jamais inventée.
 */
export function simulateRestock(input: RestockSimulationInput): RestockSimulationResult {
  if (!Number.isFinite(input.candidateAddedUnits) || input.candidateAddedUnits <= 0) {
    return { available: false, reason: "Indiquez une quantité à recevoir valide (supérieure à 0)." };
  }
  if (input.currentStock === null) {
    return { available: false, reason: "Stock boutique actuel inconnu — impossible de simuler le réapprovisionnement." };
  }
  const projectedStock = input.currentStock + input.candidateAddedUnits;

  if (input.dailyVelocity === null) {
    return {
      available: false,
      reason: "Aucune vitesse de vente connue (pas d'historique de ventes) — le stock projeté est calculable mais pas la durée.",
    };
  }
  if (input.dailyVelocity === 0) {
    return { available: false, reason: "Aucune vente récente enregistrée — durée de stock non estimable après réapprovisionnement." };
  }

  const baseStockInput = {
    productId: input.productId ?? "",
    variantId: input.variantId ?? "",
    title: input.title ?? "",
    sku: input.sku ?? null,
    supplierStock: null,
    // dailyVelocity est déjà connu (unités/jour) : on reconstitue le total
    // 30 jours attendu par analyzeStock pour qu'il retrouve exactement la
    // même vélocité, sans jamais recalculer les seuils différemment.
    unitsSoldLast30Days: input.dailyVelocity * 30,
    lastSyncedAt: null,
  };
  const after = analyzeStock({ ...baseStockInput, storeStock: projectedStock });

  return {
    available: true,
    projectedStock,
    projectedDaysOfStock: after.daysOfStock,
    projectedStatus: after.status,
  };
}
