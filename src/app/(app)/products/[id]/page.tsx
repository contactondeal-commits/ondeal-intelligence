import { requireStore } from "@/lib/store-context";
import { prisma } from "@/lib/db";
import AppShell from "@/components/AppShell";
import MetricCard from "@/components/MetricCard";
import { notFound } from "next/navigation";

export default async function ProductDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ store?: string }>;
}) {
  const store = await requireStore(await searchParams);
  const { id } = await params;

  const product = await prisma.product.findUnique({
    where: { id },
    include: {
      variants: true,
      reviews: { orderBy: { publishedAt: "desc" }, take: 10 },
      costAssumption: true,
      scoreSnapshots: { orderBy: { computedAt: "desc" }, take: 1 },
    },
  });
  if (!product || product.storeId !== store.id) notFound();

  const scoreBreakdown = product.scoreSnapshots[0] ? (JSON.parse(product.scoreSnapshots[0].factorsJson) as {
    score: number;
    dataCompleteness: number;
    factors: Array<{ label: string; contribution: number; available: boolean; normalizedValue: number | null }>;
  }) : null;

  const avgRating = product.reviews.length > 0 ? product.reviews.reduce((s, r) => s + r.rating, 0) / product.reviews.length : null;
  const totalStock = product.variants.reduce((s, v) => s + (v.inventoryQuantity ?? 0), 0);
  const anyStockKnown = product.variants.some((v) => v.inventoryQuantity !== null);

  return (
    <AppShell store={store} active="/products">
      <div className="topbar">
        <div>
          <h1 className="page-title">{product.title}</h1>
          <p className="page-subtitle">{product.productType ?? "Catégorie non renseignée"} · statut Shopify : {product.status}</p>
        </div>
      </div>

      <div className="grid grid-3" style={{ marginBottom: 20 }}>
        <MetricCard label="OnDeal Score" value={scoreBreakdown ? `${scoreBreakdown.score}/100 (${scoreBreakdown.dataCompleteness}% de données disponibles)` : null} />
        <MetricCard label="Stock total" value={anyStockKnown ? String(totalStock) : null} />
        <MetricCard label="Note moyenne" value={avgRating !== null ? `${avgRating.toFixed(1)}/5 (${product.reviews.length} avis)` : null} />
      </div>

      {scoreBreakdown && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 12 }}>Détail du score — pourquoi ce chiffre ?</h2>
          <table className="table">
            <thead>
              <tr><th>Facteur</th><th>Disponible</th><th>Contribution</th></tr>
            </thead>
            <tbody>
              {scoreBreakdown.factors.map((f, i) => (
                <tr key={i}>
                  <td>{f.label}</td>
                  <td>{f.available ? "Oui" : <span className="unavailable-note">Non disponible</span>}</td>
                  <td>{f.contribution.toFixed(1)} pts</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 12 }}>Variantes & stock</h2>
        <table className="table">
          <thead>
            <tr><th>Variante</th><th>SKU</th><th>Prix</th><th>Stock boutique</th><th>Stock fournisseur</th></tr>
          </thead>
          <tbody>
            {product.variants.map((v) => (
              <tr key={v.id}>
                <td>{v.title}</td>
                <td>{v.sku ?? "—"}</td>
                <td>{v.price !== null ? `${v.price.toFixed(2)} €` : <span className="unavailable-note">n/d</span>}</td>
                <td>{v.inventoryQuantity ?? <span className="unavailable-note">n/d</span>}</td>
                <td>{v.supplierStock ?? <span className="unavailable-note">n/d</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 12 }}>Derniers avis réels</h2>
        {product.reviews.length === 0 ? (
          <p className="unavailable-note">Aucun avis pour ce produit.</p>
        ) : (
          product.reviews.map((r) => (
            <div key={r.id} style={{ padding: "10px 0", borderBottom: "1px solid var(--color-border)" }}>
              <div style={{ fontWeight: 700 }}>{"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)} {r.title ?? ""}</div>
              <div style={{ fontSize: 13.5, color: "#6b6b85" }}>{r.body}</div>
              <div style={{ fontSize: 12, color: "#9a9ab0", marginTop: 4 }}>
                {r.authorName ?? "Anonyme"} — {r.publishedAt.toLocaleDateString("fr-FR")}
                {r.verifiedPurchase ? " — Achat vérifié" : ""}
              </div>
            </div>
          ))
        )}
      </div>
    </AppShell>
  );
}
