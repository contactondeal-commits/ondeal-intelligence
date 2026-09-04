/**
 * Fenêtre de vélocité de vente — définition UNIQUE partagée par l'analyse
 * (pipeline.ts), la preuve stock des missions (stockEvidence.ts) et la page
 * Stock. Corrige un défaut relevé par l'audit du 03/09/2026 : « les 30
 * dernières lignes » de SalesSnapshot ne sont pas « les 30 derniers jours »
 * (les jours sans vente n'ont pas de ligne), ce qui surestimait la vélocité.
 *
 * Règle : unités vendues sur les 30 derniers jours calendaires. Si le produit
 * n'a AUCUNE ligne de vente dans cette fenêtre :
 *   - mais en a eu avant → 0 (vraie absence de vente récente, stock dormant),
 *   - et n'en a jamais eu → null (donnée manquante, jamais 0 par défaut).
 */
export const SALES_WINDOW_DAYS = 30;

export function salesWindowStart(now: Date = new Date()): Date {
  const d = new Date(now.getTime() - SALES_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  return new Date(d.toISOString().slice(0, 10));
}

export function unitsSoldInWindow(rowsInWindow: Array<{ unitsSold: number }>, hasAnySalesHistory: boolean): number | null {
  if (rowsInWindow.length > 0) return rowsInWindow.reduce((s, r) => s + r.unitsSold, 0);
  return hasAnySalesHistory ? 0 : null;
}
