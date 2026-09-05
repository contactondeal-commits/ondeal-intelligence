import Link from "next/link";
import { requireStore } from "@/lib/store-context";
import { prisma } from "@/lib/db";
import AppShell from "@/components/AppShell";
import Pagination from "@/components/ui/Pagination";
import TableControls from "@/components/ui/TableControls";
import DataTag from "@/components/ui/DataTag";
import StockQuantityCell from "@/components/StockQuantityCell";
import SecureRupturesPanel from "@/components/SecureRupturesPanel";
import { parsePageParams } from "@/lib/pagination";
import { analyzeStock, summarizeStock, type StockInput } from "@/lib/intelligence/stock";
import { salesWindowStart, unitsSoldInWindow } from "@/lib/intelligence/salesWindow";
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

type Params = { store?: string; q?: string; status?: string; sort?: string; page?: string; pageSize?: string };

const STATUS_OPTIONS = [
  { value: "all", label: "Tous les statuts" },
  { value: "critical", label: "Critique (rupture, imminente, incohérence)" },
  ...Object.entries(STATUS_META).map(([value, m]) => ({ value, label: m.label })),
];
const SORT_OPTIONS = [
  { value: "critical", label: "Criticité" },
  { value: "stock_asc", label: "Stock croissant" },
  { value: "stock_desc", label: "Stock décroissant" },
  { value: "title", label: "Nom du produit" },
];
const STATUS_ORDER: Record<string, number> = { rupture: 0, rupture_imminente: 1, stock_faible: 2, stock_dormant: 3, surstock: 4, stock_normal: 5, inconnu: 6 };

/**
 * STOCK INTELLIGENCE — analyse de toutes les variantes en mémoire à partir
 * d'une lecture légère (id, stock, ventes 30 j agrégées par produit), puis
 * pagination : jamais les 16 407 lignes dans le HTML. Mêmes fonctions pures
 * que le pipeline (`analyzeStock`, `salesWindow`).
 */
export default async function StockPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const store = await requireStore(params);
  const { page, pageSize } = parsePageParams(params);
  const status = STATUS_OPTIONS.some((o) => o.value === params.status) ? (params.status as string) : "all";
  const sort = SORT_OPTIONS.some((o) => o.value === params.sort) ? (params.sort as string) : "critical";

  const [products, variants, salesInWindow, salesHistory, shopifyIntegration, cjIntegration] = await Promise.all([
    prisma.product.findMany({ where: { storeId: store.id }, select: { id: true, title: true, _count: { select: { variants: true } } } }),
    prisma.variant.findMany({
      where: { product: { storeId: store.id } },
      select: { id: true, productId: true, title: true, sku: true, inventoryQuantity: true, supplierStock: true, updatedAt: true },
    }),
    prisma.salesSnapshot.groupBy({ by: ["productId"], where: { product: { storeId: store.id }, date: { gte: salesWindowStart() } }, _sum: { unitsSold: true } }),
    prisma.salesSnapshot.groupBy({ by: ["productId"], where: { product: { storeId: store.id } }, _count: true }),
    prisma.integration.findUnique({ where: { storeId_provider: { storeId: store.id, provider: "SHOPIFY" } }, select: { status: true } }),
    prisma.integration.findUnique({ where: { storeId_provider: { storeId: store.id, provider: "CJDROPSHIPPING" } }, select: { status: true } }),
  ]);
  // Modification du stock réservée à Shopify (seule plateforme avec une
  // mutation d'écriture implémentée — voir actionKind.ts) : le contrôle
  // reste visible mais désactivé pour WooCommerce/PrestaShop, avec explication.
  const shopifyConnected = shopifyIntegration?.status === "CONNECTED";
  const cjConnected = cjIntegration?.status === "CONNECTED";
  const productById = new Map(products.map((p) => [p.id, p]));
  const unitsByProduct = new Map(salesInWindow.map((s) => [s.productId, s._sum.unitsSold ?? 0]));
  const historyByProduct = new Set(salesHistory.map((s) => s.productId));

  const analyses: StockAnalysis[] = variants.map((v) => {
    const p = productById.get(v.productId);
    const units = unitsByProduct.has(v.productId) ? [{ unitsSold: unitsByProduct.get(v.productId)! }] : [];
    const input: StockInput = {
      productId: v.productId,
      variantId: v.id,
      title: p ? (p._count.variants > 1 ? `${p.title} — ${v.title}` : p.title) : v.title,
      sku: v.sku,
      storeStock: v.inventoryQuantity,
      supplierStock: v.supplierStock,
      unitsSoldLast30Days: unitsSoldInWindow(units, historyByProduct.has(v.productId)),
      lastSyncedAt: v.updatedAt.toISOString(),
    };
    return analyzeStock(input);
  });

  const summary = summarizeStock(analyses);
  const anyData = analyses.length > 0;
  const criticalCount = analyses.filter((a) => a.status === "rupture" || a.status === "rupture_imminente" || a.supplierMismatch).length;
  const q = params.q?.trim().toLowerCase();

  let filtered = analyses;
  if (status === "critical") filtered = filtered.filter((a) => a.status === "rupture" || a.status === "rupture_imminente" || a.supplierMismatch);
  else if (status !== "all") filtered = filtered.filter((a) => a.status === status);
  if (q) filtered = filtered.filter((a) => a.title.toLowerCase().includes(q) || (a.sku ?? "").toLowerCase().includes(q));
  filtered = [...filtered].sort((a, b) => {
    if (sort === "stock_asc") return (a.storeStock ?? Infinity) - (b.storeStock ?? Infinity) || a.title.localeCompare(b.title);
    if (sort === "stock_desc") return (b.storeStock ?? -1) - (a.storeStock ?? -1) || a.title.localeCompare(b.title);
    if (sort === "title") return a.title.localeCompare(b.title);
    return STATUS_ORDER[a.status]! - STATUS_ORDER[b.status]! || a.title.localeCompare(b.title);
  });
  const total = filtered.length;
  const rows = filtered.slice((page - 1) * pageSize, page * pageSize);
  const urlParams: Record<string, string | undefined> = { store: store.id, q: params.q, status, sort, pageSize: params.pageSize };

  return (
    <AppShell store={store} active="/stock">
      <div className="topbar">
        <div>
          <h1 className="page-title">Stock Intelligence</h1>
          <p className="page-subtitle">
            Jours de stock = stock actuel ÷ vitesse moyenne de vente (30 derniers jours calendaires). Stock lu dans Shopify ; statuts calculés, jamais
            estimés au jugé.
          </p>
        </div>
      </div>

      <SecureRupturesPanel storeId={store.id} ruptureCount={summary.rupture} cjConnected={cjConnected} shopifyConnected={shopifyConnected} />

      <div className="stat-strip" role="list">
        <StatTile label="Variantes suivies" value={anyData ? analyses.length.toLocaleString("fr-FR") : "—"} tag="real" />
        <StatTile label="Situations critiques" value={anyData ? criticalCount.toLocaleString("fr-FR") : "—"} tag="calculated" tone={criticalCount > 0 ? "danger" : undefined} />
        <StatTile label="Ruptures" value={anyData ? summary.rupture.toLocaleString("fr-FR") : "—"} tag="real" />
        <StatTile label="Rupture imminente" value={anyData ? String(summary.ruptureImminente) : "—"} tag="calculated" />
        <StatTile label="Vélocité inconnue" value={anyData ? summary.inconnu.toLocaleString("fr-FR") : "—"} tag="unavailable" hint="Aucune vente sur 30 jours connue" />
      </div>

      <div className="card card-table">
        <TableControls
          params={urlParams}
          searchPlaceholder="Rechercher un produit, une variante, un SKU"
          filters={[{ key: "status", label: "Statut", value: status, options: STATUS_OPTIONS }]}
          sort={{ key: "sort", label: "Tri", value: sort, options: SORT_OPTIONS }}
        />
        <div className="table-scroll">
          <table className="table table-compact">
            <thead>
              <tr>
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
                  <td colSpan={6} className="unavailable-note" style={{ padding: 24, textAlign: "center" }}>
                    Aucune variante ne correspond à ces critères.
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.variantId}>
                  <td className="cell-title">
                    <Link href={`/products/${r.productId}?store=${store.id}`} style={{ color: "inherit" }}>
                      {r.title}
                    </Link>
                  </td>
                  <td className="cell-sub">{r.sku ?? "—"}</td>
                  <td className="num">
                    <StockQuantityCell storeId={store.id} variantId={r.variantId} currentQuantity={r.storeStock} shopifyConnected={shopifyConnected} />
                  </td>
                  <td className="num">{r.supplierStock ?? <span className="unavailable-note">n/d</span>}</td>
                  <td className="num">{r.daysOfStock !== null ? Math.round(r.daysOfStock) : <span className="unavailable-note">n/d</span>}</td>
                  <td>
                    <span className={`badge ${STATUS_META[r.status]!.cls}`}>{STATUS_META[r.status]!.label}</span>
                    {r.supplierMismatch && <span className="badge badge-urgent" style={{ marginLeft: 4 }}>Fournisseur dispo</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination total={total} page={page} pageSize={pageSize} params={urlParams} label="variantes" />
      </div>
    </AppShell>
  );
}

function StatTile({ label, value, tag, hint, tone }: { label: string; value: string; tag: "real" | "calculated" | "estimated" | "unavailable"; hint?: string; tone?: "danger" | "warning" }) {
  return (
    <div className={`stat-tile${tone ? ` stat-tile-${tone}` : ""}`} role="listitem">
      <div className="stat-tile-label">
        {label} <DataTag status={tag} compact />
      </div>
      <div className="stat-tile-value">{value}</div>
      {hint && <div className="stat-tile-hint">{hint}</div>}
    </div>
  );
}
