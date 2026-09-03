import { requireStore } from "@/lib/store-context";
import { prisma } from "@/lib/db";
import AppShell from "@/components/AppShell";
import MetricCard from "@/components/MetricCard";
import { analyzeStock, summarizeStock, type StockInput } from "@/lib/intelligence/stock";

const STATUS_META: Record<string, { label: string; cls: string }> = {
  rupture: { label: "🔴 Rupture", cls: "badge-urgent" },
  rupture_imminente: { label: "🟠 Rupture imminente", cls: "badge-opportunity" },
  stock_faible: { label: "🟡 Stock faible", cls: "badge-neutral" },
  stock_normal: { label: "🟢 Normal", cls: "badge-suggestion" },
  surstock: { label: "🔵 Surstock", cls: "badge-neutral" },
  stock_dormant: { label: "⚪ Dormant", cls: "badge-neutral" },
  inconnu: { label: "Inconnu", cls: "badge-neutral" },
};

export default async function StockPage({ searchParams }: { searchParams: Promise<{ store?: string }> }) {
  const store = await requireStore(await searchParams);

  const products = await prisma.product.findMany({
    where: { storeId: store.id },
    include: { variants: true, salesSnapshots: { orderBy: { date: "desc" }, take: 30 } },
  });

  const analyses = products.flatMap((p) =>
    p.variants.map((v) => {
      const unitsSoldLast30Days = p.salesSnapshots.length > 0 ? p.salesSnapshots.reduce((s, x) => s + x.unitsSold, 0) : null;
      const input: StockInput = {
        productId: p.id,
        variantId: v.id,
        title: p.variants.length > 1 ? `${p.title} — ${v.title}` : p.title,
        sku: v.sku,
        storeStock: v.inventoryQuantity,
        supplierStock: v.supplierStock,
        unitsSoldLast30Days,
        lastSyncedAt: v.updatedAt.toISOString(),
      };
      return analyzeStock(input);
    }),
  );

  const summary = summarizeStock(analyses);
  const anyData = analyses.length > 0;

  const critical = analyses.filter((a) => a.status === "rupture" || a.status === "rupture_imminente" || a.supplierMismatch);
  const rest = analyses.filter((a) => !critical.includes(a));
  const REST_PREVIEW = 25;
  const restPreview = rest.slice(0, REST_PREVIEW);
  const availableFromSupplier = critical.filter((a) => a.supplierStock !== null && a.supplierStock > 0).length;

  return (
    <AppShell store={store} active="/stock">
      <div className="hero-health">
        <div className="hero-health-body">
          <h1 className="hero-health-greeting">Stock Intelligence</h1>
          <p className="hero-health-subtitle">
            Jours de stock estimés = stock actuel ÷ vitesse moyenne de vente (30 derniers jours). Statuts calculés en temps réel, jamais estimés au jugé.
          </p>
          <div className="hero-health-stats">
            <div>
              <div className="hero-health-stat-label">Situations critiques</div>
              <div className="hero-health-stat-value">{anyData ? critical.length : "N/D"}</div>
            </div>
            <div>
              <div className="hero-health-stat-label">Réapprovisionnables chez le fournisseur</div>
              <div className="hero-health-stat-value">{anyData ? availableFromSupplier : "N/D"}</div>
            </div>
            <div>
              <div className="hero-health-stat-label">Variantes suivies</div>
              <div className="hero-health-stat-value">{analyses.length}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-4" style={{ marginBottom: 20 }}>
        <MetricCard label="Ruptures" value={anyData ? String(summary.rupture) : null} />
        <MetricCard label="Rupture imminente" value={anyData ? String(summary.ruptureImminente) : null} />
        <MetricCard label="Stock faible" value={anyData ? String(summary.stockFaible) : null} />
        <MetricCard label="Incohérences fournisseur" value={anyData ? String(summary.supplierMismatch) : null} />
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 12 }}>🔴 Critique — à traiter en priorité</h2>
        {critical.length === 0 ? (
          <p className="unavailable-note">Aucun produit en situation critique.</p>
        ) : (
          <StockTable rows={critical} />
        )}
      </div>

      <div className="card">
        <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 4 }}>Tous les produits</h2>
        {rest.length > REST_PREVIEW && (
          <p className="unavailable-note" style={{ marginBottom: 12 }}>
            Affichage des {REST_PREVIEW} premiers sur {rest.length} — filtrez depuis Product Intelligence pour la liste complète.
          </p>
        )}
        {restPreview.length === 0 ? <p className="unavailable-note">Aucune donnée de stock synchronisée.</p> : <StockTable rows={restPreview} />}
      </div>
    </AppShell>
  );
}

function StockTable({ rows }: { rows: ReturnType<typeof analyzeStock>[] }) {
  return (
    <table className="table">
      <thead>
        <tr><th>Produit</th><th>SKU</th><th>Stock</th><th>Stock fournisseur</th><th>Jours de stock</th><th>Statut</th></tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.variantId}>
            <td>{r.title}</td>
            <td>{r.sku ?? "—"}</td>
            <td>{r.storeStock ?? <span className="unavailable-note">n/d</span>}</td>
            <td>{r.supplierStock ?? <span className="unavailable-note">n/d</span>}</td>
            <td>{r.daysOfStock !== null ? Math.round(r.daysOfStock) : <span className="unavailable-note">n/d</span>}</td>
            <td><span className={`badge ${STATUS_META[r.status]!.cls}`}>{STATUS_META[r.status]!.label}</span></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
