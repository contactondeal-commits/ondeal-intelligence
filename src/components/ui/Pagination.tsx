import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { pageCount, withParams } from "@/lib/pagination";

/**
 * Pagination serveur — liens réels (pas d'état client), accessibles au
 * clavier, avec le total exact toujours affiché : rien n'est masqué.
 */
export default function Pagination({
  total,
  page,
  pageSize,
  params,
  label,
}: {
  total: number;
  page: number;
  pageSize: number;
  params: Record<string, string | undefined>;
  label: string;
}) {
  const pages = pageCount(total, pageSize);
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav className="pagination" aria-label={`Pagination — ${label}`}>
      <span className="pagination-summary">
        {total === 0 ? `Aucun ${label}` : `${from}–${to} sur ${total.toLocaleString("fr-FR")} ${label}`}
      </span>
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
