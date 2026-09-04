"use client";

import { useRouter, usePathname } from "next/navigation";
import { useState, useTransition } from "react";
import { Search } from "lucide-react";
import { withParams } from "@/lib/pagination";

export interface SelectFilter {
  key: string;
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
}

/**
 * Barre de contrôle d'une table paginée côté serveur : recherche, filtres,
 * tri. Chaque changement met à jour l'URL (état partageable, bouton retour
 * fonctionnel) et remet la page à 1 — aucune donnée n'est filtrée côté
 * client, la base fait le travail.
 */
export default function TableControls({
  params,
  searchPlaceholder,
  filters,
  sort,
}: {
  params: Record<string, string | undefined>;
  searchPlaceholder: string;
  filters: SelectFilter[];
  sort?: SelectFilter;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [q, setQ] = useState(params.q ?? "");
  const [pending, startTransition] = useTransition();

  function navigate(patch: Record<string, string | undefined>) {
    startTransition(() => {
      router.push(`${pathname}${withParams(params, { ...patch, page: undefined })}`);
    });
  }

  return (
    <form
      className={`table-controls${pending ? " is-pending" : ""}`}
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        navigate({ q: q.trim() || undefined });
      }}
    >
      <label className="table-search">
        <Search size={15} aria-hidden="true" />
        <input
          type="search"
          value={q}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          onChange={(e) => setQ(e.target.value)}
        />
      </label>
      {filters.map((f) => (
        <label key={f.key} className="table-filter">
          <span>{f.label}</span>
          <select value={f.value} aria-label={f.label} onChange={(e) => navigate({ [f.key]: e.target.value || undefined })}>
            {f.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      ))}
      {sort && (
        <label className="table-filter">
          <span>{sort.label}</span>
          <select value={sort.value} aria-label={sort.label} onChange={(e) => navigate({ [sort.key]: e.target.value || undefined })}>
            {sort.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <button type="submit" className="btn btn-secondary btn-sm">
        Rechercher
      </button>
    </form>
  );
}
