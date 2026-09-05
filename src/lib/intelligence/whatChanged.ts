/**
 * « Qu'est-ce qui a changé » — Command Center (lot 6, 05/09/2026).
 *
 * Ajoute une comparaison temporelle (7/30/90 jours) au Dashboard existant,
 * SANS créer de nouvelle table ni dupliquer une donnée : s'appuie sur
 * `MarginSnapshot` (CA/marge quotidiens, déjà reconstruits à chaque
 * synchronisation sur une fenêtre glissante de 90 jours — voir
 * `rebuildMarginSnapshots` dans `src/lib/sync/shopifyStore.ts`) et sur
 * l'historique de `ScoreSnapshot` (un enregistrement par produit à chaque
 * recalcul d'intelligence — voir `recomputeStoreIntelligence`).
 *
 * Logique pure, testable indépendamment de Prisma/Next : le glue (requêtes,
 * lecture de la fenêtre choisie depuis l'URL) reste dans
 * `src/app/(app)/dashboard/page.tsx`, comme pour les autres modules de
 * `src/lib/intelligence`.
 *
 * Deux formes de comparaison, choisies pour rester honnêtes :
 *  - Revenu/marge/commandes : somme sur la fenêtre courante vs somme sur la
 *    fenêtre précédente de même durée (métrique de flux — additionner a du
 *    sens).
 *  - Score de santé : valeur ponctuelle aujourd'hui vs valeur ponctuelle il
 *    y a N jours, comparée UNIQUEMENT sur les produits présents aux deux
 *    dates (métrique de niveau — moyenner sur des ensembles de produits
 *    différents donnerait un delta qui reflète le catalogue, pas la santé).
 */

export const WHAT_CHANGED_WINDOWS = [7, 30, 90] as const;
export type WhatChangedWindow = (typeof WHAT_CHANGED_WINDOWS)[number];
const DEFAULT_WHAT_CHANGED_WINDOW: WhatChangedWindow = 30;

export function parseWhatChangedWindow(raw: string | undefined): WhatChangedWindow {
  const n = Number(raw);
  return (WHAT_CHANGED_WINDOWS as readonly number[]).includes(n) ? (n as WhatChangedWindow) : DEFAULT_WHAT_CHANGED_WINDOW;
}

// Nombre minimal de commandes sur la période PRÉCÉDENTE pour afficher un
// pourcentage d'évolution — une variation calculée sur 1-2 commandes est du
// bruit statistique présenté comme un insight, pas une information. Seuil
// plus bas sur 7 jours qu'sur 30/90 (un commerce modeste peut légitimement
// n'avoir que quelques commandes par semaine sans que ce soit un défaut de
// mesure).
export function minOrdersForTrend(windowDays: WhatChangedWindow): number {
  return windowDays >= 30 ? 10 : 3;
}

export interface MarginSnapshotRow {
  date: Date;
  revenue: number;
  /** Marge complète du jour (après transport + frais), sur la part du CA à coût connu — null si aucun coût connu ce jour-là. Même sémantique que MarginSnapshot.margin. */
  margin: number | null;
  /** Part du CA du jour où le coût est connu (0–1) — même champ que MarginSnapshot.costCoverage. */
  costCoverage: number;
  orderCount: number;
  unitsSold: number;
}

export interface WindowAggregate {
  revenue: number;
  orderCount: number;
  unitsSold: number;
  /** CA cumulé de la part à coût connu (revenue × costCoverage, sommé jour par jour) — jamais deviné. */
  marginKnownRevenue: number;
  /** null si aucun jour de la fenêtre n'a de coût connu. */
  margin: number | null;
  /** margin / marginKnownRevenue — jamais / revenue total (cohérent avec MarginSnapshot.marginRate). */
  marginRate: number | null;
  daysWithOrders: number;
}

function sumAggregate(rows: MarginSnapshotRow[]): WindowAggregate {
  let revenue = 0;
  let orderCount = 0;
  let unitsSold = 0;
  let marginKnownRevenue = 0;
  let margin = 0;
  let hasMargin = false;
  let daysWithOrders = 0;

  for (const r of rows) {
    revenue += r.revenue;
    orderCount += r.orderCount;
    unitsSold += r.unitsSold;
    if (r.orderCount > 0) daysWithOrders += 1;
    marginKnownRevenue += r.revenue * r.costCoverage;
    if (r.margin !== null) {
      margin += r.margin;
      hasMargin = true;
    }
  }

  const marginRate = hasMargin && marginKnownRevenue > 0 ? margin / marginKnownRevenue : null;
  return { revenue, orderCount, unitsSold, marginKnownRevenue, margin: hasMargin ? margin : null, marginRate, daysWithOrders };
}

/** Filtre les lignes dans [from, toExclusive) puis agrège — bornes en millisecondes, jamais une comparaison de chaînes de date. */
export function aggregateWindow(rows: MarginSnapshotRow[], from: Date, toExclusive: Date): WindowAggregate {
  const fromMs = from.getTime();
  const toMs = toExclusive.getTime();
  return sumAggregate(rows.filter((r) => r.date.getTime() >= fromMs && r.date.getTime() < toMs));
}

export interface TrendResult {
  /** null si l'historique de la période précédente est insuffisant pour être significatif. */
  deltaPct: number | null;
  label: string | null;
}

export function computeTrend(current: number, previous: number, previousOrderCount: number, windowDays: WhatChangedWindow): TrendResult {
  if (previousOrderCount < minOrdersForTrend(windowDays) || previous <= 0) return { deltaPct: null, label: null };
  const deltaPct = ((current - previous) / previous) * 100;
  return { deltaPct, label: `${deltaPct >= 0 ? "+" : ""}${deltaPct.toFixed(1)} %` };
}

/** Écart en points de pourcentage entre deux taux de marge — null si l'un des deux est indisponible (jamais deviné). */
export function marginRateDeltaPts(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null) return null;
  return Math.round((current - previous) * 1000) / 10;
}

export interface ScoreTrendResult {
  currentAvg: number | null;
  previousAvg: number | null;
  /** Écart en points de score (0-100), arrondi — null si historique insuffisant. */
  deltaPts: number | null;
  /** Nombre de produits présents à la fois aujourd'hui et à la date cible. */
  coverageCount: number;
  totalCurrentCount: number;
  hasEnoughHistory: boolean;
}

// Comparer sur au moins la moitié des produits actuellement scorés — sous
// ce seuil, la moyenne "il y a N jours" porterait sur un sous-ensemble trop
// différent du catalogue actuel pour que l'écart soit interprétable comme
// une évolution de santé plutôt qu'un artefact du catalogue.
const MIN_COVERAGE_RATIO = 0.5;

/**
 * Compare la moyenne des scores UNIQUEMENT sur les produits présents aux
 * deux dates (jamais deux moyennes sur des ensembles de produits
 * différents, qui refléteraient un changement de catalogue plutôt qu'une
 * évolution réelle de santé).
 */
export function computeScoreTrend(
  currentScores: Array<{ productId: string; score: number }>,
  historicalScores: Array<{ productId: string; score: number }>,
): ScoreTrendResult {
  const totalCurrentCount = currentScores.length;
  const currentAvg = totalCurrentCount > 0 ? currentScores.reduce((s, c) => s + c.score, 0) / totalCurrentCount : null;

  const histByProduct = new Map(historicalScores.map((h) => [h.productId, h.score]));
  const matched: number[] = [];
  for (const c of currentScores) {
    const prev = histByProduct.get(c.productId);
    if (prev !== undefined) matched.push(prev);
  }
  const coverageCount = matched.length;
  const previousAvg = coverageCount > 0 ? matched.reduce((s, v) => s + v, 0) / coverageCount : null;
  const hasEnoughHistory = totalCurrentCount > 0 && coverageCount > 0 && coverageCount / totalCurrentCount >= MIN_COVERAGE_RATIO;
  const deltaPts = hasEnoughHistory && currentAvg !== null && previousAvg !== null ? Math.round(currentAvg - previousAvg) : null;

  return { currentAvg, previousAvg, deltaPts, coverageCount, totalCurrentCount, hasEnoughHistory };
}
