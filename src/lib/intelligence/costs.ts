/**
 * Résolution des coûts d'une variante — SOURCE DE VÉRITÉ explicite.
 *
 * Règles (vertical slice « marge réelle par variante », 03/09/2026) :
 *   - `Variant.unitCost` (coût réel renseigné dans Shopify) est PRIORITAIRE.
 *   - `CostAssumption.supplierCost` (saisi dans OnDeal, par produit) n'est
 *     utilisé qu'en REPLI explicite quand Shopify ne fournit aucun coût.
 *   - Aucun coût n'est jamais inventé ni estimé : sans l'un ni l'autre, le
 *     coût est `null` et sa source `unavailable`.
 *   - Transport et frais de paiement sont TOUJOURS des hypothèses
 *     (`estimated`) : hypothèse produit (`CostAssumption`) si présente, sinon
 *     hypothèse boutique (`Store.defaultShippingCost` /
 *     `Store.defaultPaymentFeesRate`), sinon indisponible.
 *
 * Chaque valeur est retournée avec sa source, pour que l'UI puisse toujours
 * distinguer REAL / ESTIMATED / UNAVAILABLE sans réinterpréter.
 */

export type SupplierCostSource = "shopify_unit_cost" | "cost_assumption" | "unavailable";
export type AssumptionSource = "product_assumption" | "store_default" | "unavailable";

export interface ResolvedCostInputs {
  supplierCost: number | null;
  supplierCostSource: SupplierCostSource;
  shippingCost: number | null;
  shippingCostSource: AssumptionSource;
  paymentFeesRate: number | null;
  paymentFeesRateSource: AssumptionSource;
  otherFixedCost: number | null;
  otherFixedCostSource: AssumptionSource;
}

export interface VariantCostLike {
  unitCost: number | null;
}
export interface CostAssumptionLike {
  supplierCost: number | null;
  shippingCost: number | null;
  paymentFeesRate: number | null;
  otherFixedCost: number | null;
}
export interface StoreCostDefaultsLike {
  defaultShippingCost: number | null;
  defaultPaymentFeesRate: number | null;
}

export function resolveCostInputs(
  variant: VariantCostLike | null,
  costAssumption: CostAssumptionLike | null,
  storeDefaults: StoreCostDefaultsLike | null,
): ResolvedCostInputs {
  const unitCost = variant?.unitCost ?? null;
  const assumedSupplier = costAssumption?.supplierCost ?? null;

  const supplier: Pick<ResolvedCostInputs, "supplierCost" | "supplierCostSource"> =
    unitCost !== null
      ? { supplierCost: unitCost, supplierCostSource: "shopify_unit_cost" }
      : assumedSupplier !== null
        ? { supplierCost: assumedSupplier, supplierCostSource: "cost_assumption" }
        : { supplierCost: null, supplierCostSource: "unavailable" };

  const shipping = pickAssumption(costAssumption?.shippingCost ?? null, storeDefaults?.defaultShippingCost ?? null);
  const fees = pickAssumption(costAssumption?.paymentFeesRate ?? null, storeDefaults?.defaultPaymentFeesRate ?? null);
  const other = pickAssumption(costAssumption?.otherFixedCost ?? null, null);

  return {
    ...supplier,
    shippingCost: shipping.value,
    shippingCostSource: shipping.source,
    paymentFeesRate: fees.value,
    paymentFeesRateSource: fees.source,
    otherFixedCost: other.value,
    otherFixedCostSource: other.source,
  };
}

function pickAssumption(productValue: number | null, storeValue: number | null): { value: number | null; source: AssumptionSource } {
  if (productValue !== null) return { value: productValue, source: "product_assumption" };
  if (storeValue !== null) return { value: storeValue, source: "store_default" };
  return { value: null, source: "unavailable" };
}

export function supplierCostSourceLabel(source: SupplierCostSource): string {
  switch (source) {
    case "shopify_unit_cost":
      return "Coût réel Shopify";
    case "cost_assumption":
      return "Hypothèse OnDeal (repli)";
    default:
      return "Coût indisponible";
  }
}

export function assumptionSourceLabel(source: AssumptionSource): string {
  switch (source) {
    case "product_assumption":
      return "Hypothèse produit";
    case "store_default":
      return "Hypothèse boutique";
    default:
      return "Non renseigné";
  }
}
