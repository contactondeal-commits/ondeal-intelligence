/**
 * Ventes par produit — fiche Product Intelligence (lot 9, 05/09/2026).
 *
 * Réutilise `SalesSnapshot` (unités + CA quotidien par produit, déjà
 * reconstruit à chaque synchronisation — voir `rebuildSalesSnapshots` dans
 * `src/lib/sync/shopifyStore.ts`) pour donner, sur la fiche produit, la même
 * logique de comparaison temporelle que « Qu'est-ce qui a changé »
 * (`whatChanged.ts`, Dashboard) — mais à l'échelle d'UN SEUL produit, jamais
 * toute la boutique. Réutilise directement `WHAT_CHANGED_WINDOWS` /
 * `parseWhatChangedWindow` de `whatChanged.ts` pour la sélection de fenêtre
 * (mêmes 7/30/90 jours, même repli) — pas de logique dupliquée.
 *
 * `SalesSnapshot` ne trace pas de compteur de commandes par jour
 * (uniquement unités + CA) : le garde-fou anti-bruit ne peut donc pas se
 * baser sur un nombre de commandes comme `whatChanged.ts` (boutique entière)
 * — il se base ici sur le nombre d'UNITÉS vendues sur la fenêtre
 * précédente, avec un seuil plus bas qu'à l'échelle boutique (un seul
 * produit vend naturellement moins qu'un catalogue entier).
 */

import type { WhatChangedWindow } from "./whatChanged";

export interface ProductSalesRow {
  date: Date;
  unitsSold: number;
  revenue: number;
}

export interface ProductSalesWindowAggregate {
  unitsSold: number;
  revenue: number;
  daysWithSales: number;
}

/** Filtre les lignes dans [from, toExclusive) puis agrège — bornes en millisecondes, jamais une comparaison de chaînes de date. */
export function aggregateProductSalesWindow(rows: ProductSalesRow[], from: Date, toExclusive: Date): ProductSalesWindowAggregate {
  const fromMs = from.getTime();
  const toMs = toExclusive.getTime();
  let unitsSold = 0;
  let revenue = 0;
  let daysWithSales = 0;
  for (const r of rows) {
    const t = r.date.getTime();
    if (t >= fromMs && t < toMs) {
      unitsSold += r.unitsSold;
      revenue += r.revenue;
      if (r.unitsSold > 0) daysWithSales += 1;
    }
  }
  return { unitsSold, revenue, daysWithSales };
}

// Seuil minimal d'UNITÉS vendues sur la fenêtre PRÉCÉDENTE pour afficher un
// delta — sous ce seuil, une évolution en % serait du bruit statistique
// présenté comme un insight (ex. 1 unité vendue puis 2 = "+100 %", un faux
// signal). Plus bas sur 7j (un produit modeste peut légitimement vendre peu
// en une semaine sans que ce soit un défaut de mesure) que sur 30/90j.
export function minUnitsForProductTrend(windowDays: WhatChangedWindow): number {
  return windowDays >= 30 ? 8 : 3;
}

export interface ProductTrendResult {
  /** null si l'historique de la fenêtre précédente est insuffisant (voir minUnitsForProductTrend). */
  deltaUnitsPct: number | null;
  /** null si le delta unités est disponible mais qu'aucun CA n'a été fait sur la fenêtre précédente. */
  deltaRevenuePct: number | null;
  label: string | null;
}

export function computeProductSalesTrend(
  current: ProductSalesWindowAggregate,
  previous: ProductSalesWindowAggregate,
  windowDays: WhatChangedWindow,
): ProductTrendResult {
  if (previous.unitsSold < minUnitsForProductTrend(windowDays)) {
    return { deltaUnitsPct: null, deltaRevenuePct: null, label: null };
  }
  const deltaUnitsPct = ((current.unitsSold - previous.unitsSold) / previous.unitsSold) * 100;
  const deltaRevenuePct = previous.revenue > 0 ? ((current.revenue - previous.revenue) / previous.revenue) * 100 : null;
  return {
    deltaUnitsPct,
    deltaRevenuePct,
    label: `${deltaUnitsPct >= 0 ? "+" : ""}${deltaUnitsPct.toFixed(0)} %`,
  };
}
