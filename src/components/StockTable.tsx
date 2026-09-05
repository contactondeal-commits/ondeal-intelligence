"use client";

import Link from "next/link";
import { useState } from "react";
import DataTag from "@/components/ui/DataTag";
import StockQuantityCell from "@/components/StockQuantityCell";
import StockBulkEditPanel, { type StockRow } from "@/components/StockBulkEditPanel";
import type { StockAnalysis } from "@/types";

const STATUS_META: Record<string, { label: string; cls: string }> = {
  rupture: { label: "Rupture", cls: "badge-urgent" },
  rupture_imminente: { label: "Rupture imminente", cls: "badge-opportunity" },
  stock_faible: { label: "Stock faible", cls: "badge-neutral" },
  stock_normal: { label: "Normal", cls: "badge-suggestion" },
  surstock: { label: "Surstock", cls: "badge-neutral" },
  stock_dormant: { label: "Dormant", cls: "badge-neutral" },
  inconnu: { label: "Vélocité inconnue", cls: "badge-neutral" },
};

const MAX_BULK = 50;

/**
 * Tableau /stock + sélection multiple + modification en masse (lot 4,
 * 05/09/2026). Composant client autonome, même principe que
 * PricingBulkTable : le serveur (page.tsx) ne fait que lire et paginer les
 * données, toute l'interaction (cases à cocher, modale de règle, appel API)
 * vit ici. `rows` = la page actuellement affichée (≤ pageSize, donc ≤ 50
 * dans les faits) ; `filteredCount` = le total correspondant aux filtres
 * actuels (pour "Appliquer à tout le filtre").
 */
export default function StockTable({
  rows,
  storeId,
  shopifyConnected,
  filteredCount,
  filters,
}: {
  rows: StockAnalysis[];
  storeId: string;
  shopifyConnected: boolean;
  filteredCount: number;
  filters: { status: string; q?: string; category: string; sort: string };
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const allSelectedOnPage = rows.length > 0 && rows.every((r) => selected.has(r.variantId));

  function toggleAll() {
    setSelected((prev) => {
      if (allSelectedOnPage) return new Set();
      const next = new Set(prev);
      for (const r of rows.slice(0, MAX_BULK)) next.add(r.variantId);
      return next;
    });
  }
  function toggleOne(variantId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(variantId)) next.delete(variantId);
      else if (next.size < MAX_BULK) next.add(variantId);
      return next;
    });
  }

  const selectedRows: StockRow[] = rows.filter((r) => selected.has(r.variantId)).map((r) => ({ variantId: r.variantId, title: r.title, storeStock: r.storeStock }));

  return (
    <>
      <StockBulkEditPanel
        storeId={storeId}
        selected={selectedRows}
        onClearSelection={() => setSelected(new Set())}
        filteredCount={filteredCount}
        filters={filters}
        shopifyConnected={shopifyConnected}
      />

      <div className="table-scroll">
        <table className="table table-compact">
          <thead>
            <tr>
              <th style={{ width: 28 }}>
                <input type="checkbox" checked={allSelectedOnPage} onChange={toggleAll} disabled={rows.length === 0} aria-label="Tout sélectionner sur cette page" />
              </th>
              <th>Produit / variante</th>
              <th>SKU</th>
              <th className="num">
                Stock <DataTag status="real" compact />
              </th>
              <th className="num">Stock fournisseur</th>
              <th className="num">
                Jours de stock <DataTag status="calculated" compact />
              </th>
              <th>Statut</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="unavailable-note" style={{ padding: 24, textAlign: "center" }}>
                  Aucune variante ne correspond à ces critères.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.variantId}>
                <td>
                  <input type="checkbox" checked={selected.has(r.variantId)} onChange={() => toggleOne(r.variantId)} aria-label={`Sélectionner ${r.title}`} />
                </td>
                <td className="cell-title">
                  <Link href={`/products/${r.productId}?store=${storeId}`} style={{ color: "inherit" }}>
                    {r.title}
                  </Link>
                </td>
                <td className="cell-sub">{r.sku ?? "—"}</td>
                <td className="num">
                  <StockQuantityCell storeId={storeId} variantId={r.variantId} currentQuantity={r.storeStock} shopifyConnected={shopifyConnected} />
                </td>
                <td className="num">{r.supplierStock ?? <span className="unavailable-note">n/d</span>}</td>
                <td className="num">{r.daysOfStock !== null ? Math.round(r.daysOfStock) : <span className="unavailable-note">n/d</span>}</td>
                <td>
                  <span className={`badge ${STATUS_META[r.status]!.cls}`}>{STATUS_META[r.status]!.label}</span>
                  {r.supplierMismatch && (
                    <span className="badge badge-urgent" style={{ marginLeft: 4 }}>
                      Fournisseur dispo
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
