import { requireStore } from "@/lib/store-context";
import { prisma } from "@/lib/db";
import AppShell from "@/components/AppShell";
import Link from "next/link";
import { classifyProduct } from "@/lib/intelligence/score";

const TIER_META: Record<string, { label: string; cls: string }> = {
  a_booster: { label: "🔥 À booster", cls: "badge-opportunity" },
  performant: { label: "🟢 Performant", cls: "badge-suggestion" },
  a_optimiser: { label: "🟡 À optimiser", cls: "badge-neutral" },
  a_surveiller: { label: "🟠 À surveiller", cls: "badge-opportunity" },
  a_revoir: { label: "🔴 À revoir", cls: "badge-urgent" },
};

export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ store?: string }> }) {
  const store = await requireStore(await searchParams);

  const products = await prisma.product.findMany({
    where: { storeId: store.id },
    include: {
      variants: true,
      reviews: true,
      scoreSnapshots: { orderBy: { computedAt: "desc" }, take: 1 },
      costAssumption: true,
    },
    orderBy: { updatedAt: "desc" },
  });

  if (products.length === 0) {
    return (
      <AppShell store={store} active="/products">
        <h1 className="page-title">Product Intelligence</h1>
        <div className="empty-state card">Aucun produit synchronisé. Connectez Shopify puis synchronisez pour voir vos produits ici.</div>
      </AppShell>
    );
  }

  return (
    <AppShell store={store} active="/products">
      <h1 className="page-title">Product Intelligence</h1>
      <p className="page-subtitle" style={{ marginBottom: 18 }}>{products.length} produit(s) — classés par OnDeal Score et signaux critiques.</p>

      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>Produit</th>
              <th>Score</th>
              <th>Classement</th>
              <th>Stock</th>
              <th>Avis</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => {
              const score = p.scoreSnapshots[0]?.score ?? null;
              const totalStock = p.variants.reduce((s, v) => s + (v.inventoryQuantity ?? 0), 0);
              const anyStockKnown = p.variants.some((v) => v.inventoryQuantity !== null);
              const avgRating = p.reviews.length > 0 ? p.reviews.reduce((s, r) => s + r.rating, 0) / p.reviews.length : null;

              const tier =
                score !== null
                  ? classifyProduct({
                      score,
                      hasStockCritical: anyStockKnown && totalStock === 0,
                      hasNegativeMargin: false,
                      salesTrendPositive: null,
                    })
                  : null;

              return (
                <tr key={p.id}>
                  <td style={{ fontWeight: 600 }}>{p.title}</td>
                  <td>{score !== null ? `${score}/100` : <span className="unavailable-note">n/d</span>}</td>
                  <td>{tier ? <span className={`badge ${TIER_META[tier]!.cls}`}>{TIER_META[tier]!.label}</span> : "—"}</td>
                  <td>{anyStockKnown ? totalStock : <span className="unavailable-note">n/d</span>}</td>
                  <td>{avgRating !== null ? `${avgRating.toFixed(1)}/5 (${p.reviews.length})` : <span className="unavailable-note">aucun</span>}</td>
                  <td>
                    <Link href={`/products/${p.id}?store=${store.id}`} style={{ color: "#4f46e5", fontWeight: 700, fontSize: 13 }}>
                      Détail →
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
