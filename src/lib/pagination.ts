/**
 * Pagination serveur — utilitaire partagé par les pages catalogue
 * (/pricing, /products, /stock, /intelligence). Jamais plus de `pageSize`
 * lignes rendues dans une page HTML, quel que soit le volume en base.
 */
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

export interface PageParams {
  page: number;
  pageSize: number;
  skip: number;
}

export function parsePageParams(raw: { page?: string; pageSize?: string } | undefined, defaultPageSize = DEFAULT_PAGE_SIZE): PageParams {
  const page = Math.max(1, Number.parseInt(raw?.page ?? "1", 10) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(10, Number.parseInt(raw?.pageSize ?? String(defaultPageSize), 10) || defaultPageSize));
  return { page, pageSize, skip: (page - 1) * pageSize };
}

export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/** Reconstruit une query string en remplaçant/supprimant certaines clés (valeur vide = supprimée). */
export function withParams(current: Record<string, string | undefined>, patch: Record<string, string | number | undefined>): string {
  const merged: Record<string, string> = {};
  for (const [k, v] of Object.entries(current)) if (v !== undefined && v !== "") merged[k] = v;
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === "") delete merged[k];
    else merged[k] = String(v);
  }
  const qs = new URLSearchParams(merged).toString();
  return qs ? `?${qs}` : "";
}
