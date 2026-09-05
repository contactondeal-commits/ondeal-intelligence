import type { PriceOutcomeMeasurement } from "@/lib/intelligence/prediction";

/**
 * AUTOMATED ACTION vs MANUAL MISSION — distinction demandée explicitement
 * pour ne jamais afficher une fausse exécution.
 *
 * Types d'action correspondant aujourd'hui à une mutation Shopify réelle
 * (`updateVariantPrice`, `updateProductStatus`, `updateVariantStock` dans
 * `src/lib/integrations/shopify.ts`) : `update_price`, `unpublish_product`,
 * `update_stock` (correctif 05/09/2026 — le type était déjà prévu dans le
 * schéma Prisma et `SENSITIVE_ACTION_TYPES`, mais aucune mutation n'existait
 * encore : la fiche produit affichait un stock "en lecture seule" sans
 * qu'aucun marchand ne puisse le corriger depuis OnDeal). Tous les autres
 * types générés par `recommendations.ts` (`review_supplier`,
 * `request_reviews`, `promote_product`, `edit_product_data`) n'ont aucune
 * mutation associée — ce sont des missions qu'OnDeal prépare et explique,
 * mais que l'utilisateur doit réaliser lui-même (contacter un fournisseur,
 * demander des avis, etc.).
 *
 * Source unique utilisée à la fois par la route d'exécution (pour taguer le
 * résultat) et par l'UI (pour ne jamais présenter une simple confirmation
 * utilisateur comme la preuve d'une mutation Shopify qui n'a pas eu lieu).
 */
export type ActionKind = "automated_mutation" | "manual_mission";

export const AUTOMATED_ACTION_TYPES = new Set(["update_price", "unpublish_product", "update_stock"]);

export function actionKindFor(type: string | null | undefined): ActionKind {
  return type && AUTOMATED_ACTION_TYPES.has(type) ? "automated_mutation" : "manual_mission";
}

export function actionKindLabel(kind: ActionKind): string {
  return kind === "automated_mutation" ? "Action automatisée" : "Mission manuelle";
}

export function actionKindDescription(kind: ActionKind): string {
  return kind === "automated_mutation"
    ? "OnDeal effectue réellement cette modification sur Shopify."
    : "OnDeal prépare et explique cette action — vous devez la réaliser vous-même. Confirmer ici enregistre uniquement que la mission a été prise en charge, jamais une mutation Shopify.";
}

/**
 * Clé de la DONNÉE CRITIQUE modifiée par une ActionItem de ce type — pas une
 * clé arbitraire, une par mutation réellement partagée (le prix vit sur la
 * variante, le statut de publication sur le produit). Utilisée pour détecter
 * qu'une AUTRE recommandation (donc potentiellement une autre ActionItem) ne
 * cible pas déjà la même donnée, avant d'en créer une deuxième qui pourrait
 * s'exécuter de façon incohérente avec la première. Deux recommandations sur
 * le même produit mais des données différentes (ex. deux variantes
 * distinctes pour `update_price`) ne doivent JAMAIS être traitées comme un
 * conflit — d'où une clé par donnée réellement mutable, pas juste par
 * produit.
 */
export function criticalTargetKey(type: string | null | undefined, payload: Record<string, unknown>, fallbackProductId: string | null): string | null {
  if (type === "update_price") {
    // Le prix vit sur la variante — deux variantes différentes du même
    // produit ne conflictent jamais entre elles.
    const variantId = typeof payload.variantId === "string" ? payload.variantId : null;
    return variantId ? `update_price:variant:${variantId}` : null;
  }
  if (type === "unpublish_product") {
    // Le statut de publication vit sur le produit.
    const productId = typeof payload.productId === "string" ? payload.productId : fallbackProductId;
    return productId ? `unpublish_product:product:${productId}` : null;
  }
  if (type === "update_stock") {
    // Le stock vit sur la variante — même logique que update_price.
    const variantId = typeof payload.variantId === "string" ? payload.variantId : null;
    return variantId ? `update_stock:variant:${variantId}` : null;
  }
  if (type === "review_supplier") {
    // La preuve (stock/vélocité) protégée par le snapshot stock vit sur la
    // variante — deux recommandations différentes (ex. catégorie "stock" et
    // catégorie "data_quality") peuvent toutes deux cibler la même variante
    // en rupture : c'est exactement le cas qui doit être coalescé.
    const variantId = typeof payload.variantId === "string" ? payload.variantId : null;
    if (variantId) return `review_supplier:variant:${variantId}`;
    // Mission agrégée par produit (voir recommendations.ts) : le payload
    // porte `variantIds` (pluriel) plutôt qu'un `variantId` unique. La clé
    // inclut l'ensemble exact des variantes concernées — pas seulement le
    // produit — pour que deux missions distinctes sur le même produit
    // (ex. "12 variantes en rupture" et "5 variantes en rupture imminente",
    // des ensembles de variantes toujours disjoints par construction) ne
    // soient jamais coalescées à tort en une seule.
    const variantIds = Array.isArray(payload.variantIds) ? payload.variantIds.filter((v): v is string => typeof v === "string") : null;
    if (variantIds && variantIds.length > 0) {
      const productId = typeof payload.productId === "string" ? payload.productId : fallbackProductId;
      return productId ? `review_supplier:product:${productId}:${[...variantIds].sort().join("|")}` : null;
    }
    return null;
  }
  // request_reviews / promote_product / edit_product_data : aucune donnée
  // mutable partagée entre deux recommandations — jamais de conflit à
  // détecter pour ces types.
  return null;
}

/** Résultat structuré d'exécution — remplace les objets ad hoc {ok, detail} pour porter le kind et les données de vérification sans fabriquer de valeur. */
export type ExecutionOutcome =
  | {
      ok: true;
      kind: "automated_mutation";
      detail: string;
      verification: string;
      before: number | string | null;
      applied: number | string;
      verified: number | string;
      /** PREDICTION → RESULT → GAP (update_price uniquement) — voir prediction.ts. Absent si aucune prédiction n'avait été persistée. */
      measurement?: PriceOutcomeMeasurement;
    }
  | { ok: true; kind: "manual_mission_completed"; detail: string }
  | { ok: false; kind: "stale_simulation"; detail: string; changedFields: Array<{ field: string; label: string; expected: number | null; actual: number | null }> }
  | { ok: false; kind: "error"; detail: string };
