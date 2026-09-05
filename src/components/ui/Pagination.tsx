"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { pageCount, withParams } from "@/lib/pagination";

/**
 * Pagination serveur — liens réels pour prev/next (pas d'état client),
 * accessibles au clavier, avec le total exact toujours affiché : rien n'est
 * masqué. `pageSizeOptions` (05/09/2026, lot 4 — demande explicite : pouvoir
 * choisir une page plus grande que 50 pour la modification de stock en
 * masse) ajoute un sélecteur "Par page" quand fourni ; converti en
 * composant client pour ce seul besoin (le reste du composant est inchangé).
 */
export default function Pagination({
  total,
  page,
  pageSize,
  params,
  label,
  pageSizeOptions,
}: {
  total: number;
  page: number;
  pageSize: number;
  params: Record<string, string | undefined>;
  label: string;
  /** Ex. [50, 100, 150] — quand fourni, affiche un sélecteur de taille de page. */
  pageSizeOptions?: number[];
}) {
  const router = useRouter();
  const pages = pageCount(total, pageSize);
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav className="pagination" aria-label={`Pagination — ${label}`}>
      <span className="pagination-summary">
        {total === 0 ? `Aucun ${label}` : `${from}–${to} sur ${total.toLocaleString("fr-FR")} ${label}`}
      </span>
      {pageSizeOptions && pageSizeOptions.length > 0 && (
        <label className="table-filter" style={{ marginLeft: 4 }}>
          <span>Par page</span>
          <select
            value={pageSize}
            aria-label="Nombre de lignes par page"
            onChange={(e) => router.push(withParams(params, { pageSize: e.target.value, page: undefined }))}
          >
            {pageSizeOptions.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="pagination-controls">
        {page > 1 ? (
          <Link className="pagination-btn" href={withParams(params, { page: page - 1 })} aria-label="Page précédente">
            <ChevronLeft size={15} />
          </Link>
        ) : (
          <span className="pagination-btn is-disabled" aria-disabled="true">
            <ChevronLeft size={15} />
          </span>
        )}
        <span className="pagination-page">
          Page {page} / {pages}
        </span>
        {page < pages ? (
          <Link className="pagination-btn" href={withParams(params, { page: page + 1 })} aria-label="Page suivante">
            <ChevronRight size={15} />
          </Link>
        ) : (
          <span className="pagination-btn is-disabled" aria-disabled="true">
            <ChevronRight size={15} />
          </span>
        )}
      </div>
    </nav>
  );
}
