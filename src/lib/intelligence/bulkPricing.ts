/**
 * Chantier 3 — Actions groupées : règles de calcul du nouveau prix pour un
 * repricing en masse. Fonctions pures, aucun accès base — les coûts sont
 * résolus par l'appelant via `resolveCostInputs` (jamais une valeur
 * réinventée ici), exactement comme `simulatePriceChange` (simulate.ts) le
 * fait déjà pour la simulation individuelle. N'exécute rien : ne fait que
 * calculer le prix candidat que /api/actions/bulk/confirm transmettra tel
 * quel au flux de confirmation existant (/api/actions/[id]/confirm), qui
 * reste seul responsable de capturer le snapshot et de vérifier la
 * fraîcheur des données avant toute mutation Shopify.
 */

export type BulkPricingRule =
  | { kind: "factor"; factor: number }
  | { kind: "target_margin"; targetRate: number };

export interface BulkPricingCosts {
  supplierCost: number | null;
  shippingCost: number | null;
  paymentFeesRate: number | null;
  otherFixedCost: number | null;
}

export type BulkPriceComputation = { ok: true; newPrice: number } | { ok: false; reason: string };

export function computeBulkPrice(rule: BulkPricingRule, currentPrice: number | null, costs: BulkPricingCosts): BulkPriceComputation {
  if (rule.kind === "factor") {
    if (currentPrice === null || currentPrice <= 0) return { ok: false, reason: "Prix actuel inconnu — impossible d'appliquer un facteur." };
    if (!Number.isFinite(rule.factor) || rule.factor <= 0) return { ok: false, reason: "Facteur invalide." };
    return { ok: true, newPrice: round2(currentPrice * rule.factor) };
  }

  // target_margin : résout le prix atteignant le taux de marge COMPLÈTE visé
  // (après transport et frais de paiement, qui sont un taux du prix lui-même
  // — pas un montant fixe). margin = price - (supplierCost + shipping +
  // otherFixed) - price*feesRate ; marginRate = margin/price = targetRate
  // ⇒ price = (supplierCost + shipping + otherFixed) / (1 - feesRate - targetRate).
  const { supplierCost, shippingCost, paymentFeesRate, otherFixedCost } = costs;
  if (supplierCost === null || shippingCost === null) {
    return { ok: false, reason: "Coût fournisseur et/ou transport manquant — marge cible non calculable pour ce produit." };
  }
  const feesRate = paymentFeesRate ?? 0;
  const fixedCost = supplierCost + shippingCost + (otherFixedCost ?? 0);
  const denominator = 1 - feesRate - rule.targetRate;
  if (denominator <= 0) {
    return { ok: false, reason: "Marge cible incompatible avec les frais de paiement actuels — aucun prix ne peut l'atteindre." };
  }
  const newPrice = fixedCost / denominator;
  if (!Number.isFinite(newPrice) || newPrice <= 0) {
    return { ok: false, reason: "Calcul impossible avec les coûts actuels." };
  }
  return { ok: true, newPrice: round2(newPrice) };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
