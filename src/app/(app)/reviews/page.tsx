import { requireStore } from "@/lib/store-context";
import { prisma } from "@/lib/db";
import AppShell from "@/components/AppShell";
import MetricCard from "@/components/MetricCard";
import Link from "next/link";
import { analyzeReviews } from "@/lib/intelligence/reviews";

export default async function ReviewsPage({ searchParams }: { searchParams: Promise<{ store?: string }> }) {
  const store = await requireStore(await searchParams);

  const [reviews, productCount, integration] = await Promise.all([
    prisma.review.findMany({ where: { storeId: store.id }, include: { product: true }, orderBy: { publishedAt: "desc" } }),
    prisma.product.count({ where: { storeId: store.id } }),
    prisma.integration.findUnique({ where: { storeId_provider: { storeId: store.id, provider: "JUDGEME" } } }),
  ]);

  const analysis = analyzeReviews({
    storeId: store.id,
    reviews: reviews.map((r) => ({ productId: r.productId, rating: r.rating, title: r.title, body: r.body, publishedAt: r.publishedAt })),
    totalProductCount: productCount,
  });

  const connected = integration?.status === "CONNECTED";

  return (
    <AppShell store={store} active="/reviews">
      <div className="topbar">
        <div>
          <h1 className="page-title">Review Intelligence</h1>
          <p className="page-subtitle">Analyse des vrais avis clients (Judge.me). Pour des données fictives de test, voir le Mode Test dédié.</p>
        </div>
        <Link href={`/reviews/test-mode?store=${store.id}`} className="btn btn-secondary">🧪 Mode Test — Avis fictifs</Link>
      </div>

      {!connected && (
        <div className="callout callout-info">
          Judge.me n'est pas connecté.{" "}
          <Link href={`/settings/integrations?store=${store.id}`} style={{ fontWeight: 700, textDecoration: "underline" }}>Connecter maintenant</Link>.
        </div>
      )}

      <div className="grid grid-4" style={{ marginBottom: 20 }}>
        <MetricCard label="Nombre d'avis" value={analysis.totalReviews > 0 ? String(analysis.totalReviews) : null} available={connected} />
        <MetricCard label="Note moyenne" value={analysis.averageRating !== null ? `${analysis.averageRating.toFixed(2)}/5` : null} />
        <MetricCard label="Avis positifs / négatifs" value={analysis.totalReviews > 0 ? `${analysis.positiveCount} / ${analysis.negativeCount}` : null} />
        <MetricCard label="Produits sans avis" value={connected ? String(analysis.productsWithoutReviews) : null} />
      </div>

      {analysis.themes.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 12 }}>Thèmes récurrents dans les avis</h2>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {analysis.themes.map((t) => (
              <span
                key={t.theme}
                className={`badge ${t.sentiment === "positif" ? "badge-suggestion" : t.sentiment === "negatif" ? "badge-urgent" : "badge-neutral"}`}
              >
                {t.theme} ({t.count})
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 12 }}>Avis récents</h2>
        {reviews.length === 0 ? (
          <p className="unavailable-note">Aucun avis synchronisé pour le moment.</p>
        ) : (
          reviews.slice(0, 30).map((r) => (
            <div key={r.id} style={{ padding: "10px 0", borderBottom: "1px solid var(--color-border)" }}>
              <div style={{ fontWeight: 700 }}>
                {"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)} {r.title ?? ""} {r.product ? `— ${r.product.title}` : ""}
              </div>
              <div style={{ fontSize: 13.5, color: "#6b6b85" }}>{r.body}</div>
              <div style={{ fontSize: 12, color: "#9a9ab0", marginTop: 4 }}>
                {r.authorName ?? "Anonyme"} — {r.publishedAt.toLocaleDateString("fr-FR")}
              </div>
            </div>
          ))
        )}
      </div>
    </AppShell>
  );
}
