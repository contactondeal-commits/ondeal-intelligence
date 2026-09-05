import type { Nullable, StockAnalysis, StockStatus } from "@/types";

// Seuils Stock Intelligence (PHASE 6). Documentés ici pour rester
// explicables depuis l'UI et les recommandations.
export const STOCK_THRESHOLDS = {
  ruptureImminenteJours: 7,
  stockFaibleJours: 14,
  surstockJours: 90,
  stockDormantJoursSansVente: 60,
} as const;

export interface StockInput {
  productId: string;
  variantId: string;
  title: string;
  sku: Nullable<string>;
  storeStock: Nullable<number>;
  supplierStock: Nullable<number>;
  // Ventes des 30 derniers jours connues (issues de SalesSnapshot). null si
  // aucune donnée de vente n'a encore été synchronisée pour ce produit.
  unitsSoldLast30Days: Nullable<number>;
  lastSyncedAt: Nullable<string>;
  // Passe-plat (Product.productType) — voir StockAnalysis.productType.
  productType?: Nullable<string>;
}

/**
 * jours de stock estimés = stock actuel / vitesse moyenne de vente
 * Vitesse moyenne = unités vendues sur 30 jours / 30. Si aucune vente n'est
 * connue sur la période, la vitesse est `null` (jamais 0 par défaut — un
 * produit neuf sans historique n'est pas "invendable", c'est une donnée
 * manquante) et le statut retombe sur `inconnu` plutôt que d'inventer un
 * nombre de jours.
 */
export function analyzeStock(input: StockInput): StockAnalysis {
  const dailyVelocity =
    input.unitsSoldLast30Days !== null ? input.unitsSoldLast30Days / 30 : null;

  const daysOfStock =
    input.storeStock !== null && dailyVelocity !== null
      ? dailyVelocity > 0
        ? input.storeStock / dailyVelocity
        : input.storeStock > 0
          ? Infinity // stock présent mais aucune vente récente → potentiel stock dormant
          : 0
      : null;

  const supplierMismatch =
    input.storeStock !== null &&
    input.storeStock === 0 &&
    input.supplierStock !== null &&
    input.supplierStock > 0;

  let status: StockStatus = "inconnu";

  if (input.storeStock !== null) {
    if (input.storeStock === 0) {
      status = "rupture";
    } else if (daysOfStock !== null) {
      if (daysOfStock === Infinity) {
        status = "stock_dormant";
      } else if (daysOfStock <= STOCK_THRESHOLDS.ruptureImminenteJours) {
        status = "rupture_imminente";
      } else if (daysOfStock <= STOCK_THRESHOLDS.stockFaibleJours) {
        status = "stock_faible";
      } else if (daysOfStock >= STOCK_THRESHOLDS.surstockJours) {
        status = "surstock";
      } else {
        status = "stock_normal";
      }
    } else {
      // Stock connu mais pas de vitesse de vente disponible : on ne peut
      // affirmer ni "normal" ni "dormant" sans historique — reste "inconnu"
      // plutôt que de deviner.
      status = "inconnu";
    }
  }

  return {
    productId: input.productId,
    variantId: input.variantId,
    title: input.title,
    sku: input.sku,
    storeStock: input.storeStock,
    supplierStock: input.supplierStock,
    dailyVelocity,
    daysOfStock: daysOfStock === Infinity ? null : daysOfStock,
    status,
    supplierMismatch,
    lastSyncedAt: input.lastSyncedAt,
    productType: input.productType ?? null,
  };
}

/** Ordre de criticité (le plus urgent en premier) — partagé par la page /stock et la modification en masse (bulk-update). */
export const STOCK_STATUS_ORDER: Record<StockStatus, number> = {
  rupture: 0,
  rupture_imminente: 1,
  stock_faible: 2,
  stock_dormant: 3,
  surstock: 4,
  stock_normal: 5,
  inconnu: 6,
};

export interface StockQueryParams {
  /** "all" | "critical" (rupture/imminente/incohérence fournisseur) | une valeur de StockStatus */
  status: string;
  q?: string;
  /** Product.productType exact, ou "all"/absent pour ne pas filtrer. */
  category?: string;
  /** "critical" | "stock_asc" | "stock_desc" | "title" */
  sort: string;
}

/**
 * Filtre + trie un ensemble d'analyses stock — SOURCE UNIQUE partagée par la
 * page /stock (rendu paginé) et /api/stock/bulk-update (mode "filtered" :
 * appliquer un changement à TOUTES les variantes correspondant aux filtres
 * actuels, pas seulement la page affichée). Toute divergence entre les deux
 * romprait la promesse "ce que vous voyez est ce qui sera modifié".
 */
export function queryStock(analyses: StockAnalysis[], params: StockQueryParams): StockAnalysis[] {
  const q = params.q?.trim().toLowerCase();
  let filtered = analyses;
  if (params.status === "critical") filtered = filtered.filter((a) => a.status === "rupture" || a.status === "rupture_imminente" || a.supplierMismatch);
  else if (params.status !== "all") filtered = filtered.filter((a) => a.status === params.status);
  if (params.category && params.category !== "all") filtered = filtered.filter((a) => a.productType === params.category);
  if (q) filtered = filtered.filter((a) => a.title.toLowerCase().includes(q) || (a.sku ?? "").toLowerCase().includes(q));
  return [...filtered].sort((a, b) => {
    if (params.sort === "stock_asc") return (a.storeStock ?? Infinity) - (b.storeStock ?? Infinity) || a.title.localeCompare(b.title);
    if (params.sort === "stock_desc") return (b.storeStock ?? -1) - (a.storeStock ?? -1) || a.title.localeCompare(b.title);
    if (params.sort === "title") return a.title.localeCompare(b.title);
    return STOCK_STATUS_ORDER[a.status] - STOCK_STATUS_ORDER[b.status] || a.title.localeCompare(b.title);
  });
}

export function summarizeStock(analyses: StockAnalysis[]) {
  return {
    total: analyses.length,
    rupture: analyses.filter((a) => a.status === "rupture").length,
    ruptureImminente: analyses.filter((a) => a.status === "rupture_imminente").length,
    stockFaible: analyses.filter((a) => a.status === "stock_faible").length,
    surstock: analyses.filter((a) => a.status === "surstock").length,
    stockDormant: analyses.filter((a) => a.status === "stock_dormant").length,
    supplierMismatch: analyses.filter((a) => a.supplierMismatch).length,
    inconnu: analyses.filter((a) => a.status === "inconnu").length,
  };
}
