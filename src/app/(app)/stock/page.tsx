import { requireStore } from "@/lib/store-context";
import { prisma } from "@/lib/db";
import AppShell from "@/components/AppShell";
import Pagination from "@/components/ui/Pagination";
import TableControls from "@/components/ui/TableControls";
import DataTag from "@/components/ui/DataTag";
import SecureRupturesPanel from "@/components/SecureRupturesPanel";
import StockTable from "@/components/StockTable";
import { parsePageParams } from "@/lib/pagination";
import { analyzeStock, summarizeStock, queryStock, type StockInput } from "@/lib/intelligence/stock";
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

type Params = { store?: string; q?: string; status?: string; category?: string; sort?: string; page?: string; pageSize?: string };

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
    prisma.product.findMany({ where: { storeId: store.id }, select: { id: true, title: true, productType: true, _count: { select: { variants: true } } } }),
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

  // Filtre "Catégorie" (05/09/2026 — modification de stock en masse) : OnDeal
  // ne synchronise pas les Collections Shopify aujourd'hui, seul
  // Product.productType (déjà synchronisé) sert de proxy "catégorie".
  const categories = [...new Set(products.map((p) => p.productType).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b));
  const CATEGORY_OPTIONS = [{ value: "all", label: "Toutes les catégories" }, ...categories.map((c) => ({ value: c, label: c }))];
  const category = CATEGORY_OPTIONS.some((o) => o.value === params.category) ? (params.category as string) : "all";

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
      productType: p?.productType ?? null,
    };
    return analyzeStock(input);
  });

  const summary = summarizeStock(analyses);
  const anyData = analyses.length > 0;
  const criticalCount = analyses.filter((a) => a.status === "rupture" || a.status === "rupture_imminente" || a.supplierMismatch).length;

  const filtered = queryStock(analyses, { status, q: params.q, category, sort });
  const total = filtered.length;
  const rows = filtered.slice((page - 1) * pageSize, page * pageSize);
  const urlParams: Record<string, string | undefined> = { store: store.id, q: params.q, status, category: category === "all" ? undefined : category, sort, pageSize: params.pageSize };

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
          filters={[
            { key: "status", label: "Statut", value: status, options: STATUS_OPTIONS },
            { key: "category", label: "Catégorie", value: category, options: CATEGORY_OPTIONS },
          ]}
          sort={{ key: "sort", label: "Tri", value: sort, options: SORT_OPTIONS }}
        />
        <StockTable rows={rows} storeId={store.id} shopifyConnected={shopifyConnected} filteredCount={total} filters={{ status, q: params.q, category, sort }} />
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
