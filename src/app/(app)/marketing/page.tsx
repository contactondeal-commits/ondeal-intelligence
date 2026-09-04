import { requireStore } from "@/lib/store-context";
import { prisma } from "@/lib/db";
import AppShell from "@/components/AppShell";
import FeatureUnavailable from "@/components/FeatureUnavailable";
import { hasFeature } from "@/lib/plan-limits";
import ContentGenerator from "@/components/ContentGenerator";
import { detectMarketingOpportunities, type MarketingProductInput } from "@/lib/intelligence/marketing";

export default async function MarketingPage({ searchParams }: { searchParams: Promise<{ store?: string }> }) {
  const store = await requireStore(await searchParams);
  if (!hasFeature(store.plan, "marketing")) {
    return (
      <AppShell store={store} active="/marketing">
        <FeatureUnavailable feature="Marketing Intelligence" plan={store.plan} storeId={store.id} />
      </AppShell>
    );
  }

  const products = await prisma.product.findMany({
    where: { storeId: store.id },
    include: { variants: true, reviews: true, costAssumption: true, scoreSnapshots: { orderBy: { computedAt: "desc" }, take: 1 } },
  });

  const inputs: MarketingProductInput[] = products.map((p) => {
    const variant = p.variants[0];
    const avgRating = p.reviews.length > 0 ? p.reviews.reduce((s, r) => s + r.rating, 0) / p.reviews.length : null;
    return {
      productId: p.id,
      title: p.title,
      productType: p.productType,
      price: variant?.price ?? null,
      compareAtPrice: variant?.compareAtPrice ?? null,
      marginRate: null, // calculé séparément si besoin — non bloquant pour la détection d'opportunité
      averageRating: avgRating,
      reviewCount: p.reviews.length,
      score: p.scoreSnapshots[0]?.score ?? 0,
      daysOfStock: null,
    };
  });

  const opportunities = detectMarketingOpportunities(inputs);
  const homepageSelection = [...products]
    .filter((p) => p.scoreSnapshots[0])
    .sort((a, b) => (b.scoreSnapshots[0]?.score ?? 0) - (a.scoreSnapshots[0]?.score ?? 0))
    .slice(0, 6);

  return (
    <AppShell store={store} active="/marketing">
      <h1 className="page-title">Marketing Intelligence</h1>
      <p className="page-subtitle" style={{ marginBottom: 18 }}>Opportunités marketing et génération de contenu à partir de vos vraies données produit.</p>

      <div className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 12 }}>Homepage Intelligence — sélection recommandée</h2>
        {homepageSelection.length === 0 ? (
          <p className="unavailable-note">Pas encore assez de données pour recommander une sélection.</p>
        ) : (
          <div className="grid grid-3">
            {homepageSelection.map((p) => (
              <div key={p.id} className="card" style={{ padding: 14 }}>
                <div style={{ fontWeight: 700, fontSize: 13.5 }}>{p.title}</div>
                <div className="unavailable-note">Score {p.scoreSnapshots[0]?.score}/100</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 12 }}>Opportunités marketing détectées</h2>
        {opportunities.length === 0 ? (
          <p className="unavailable-note">Aucune opportunité détectée pour le moment.</p>
        ) : (
          opportunities.map((o) => (
            <div key={o.productId} className="rec-card opportunity">
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700 }}>{o.title}</div>
                <div style={{ fontSize: 13.5, color: "#6b6b85" }}>{o.reason}</div>
                <div style={{ fontSize: 12.5, marginTop: 4 }}>
                  <span className="badge badge-neutral">{o.channel}</span> <span className="badge badge-neutral">{o.angle}</span>
                  {o.offer && <span className="badge badge-opportunity">{o.offer}</span>}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="card">
        <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 12 }}>Générateur de contenu (données réelles uniquement)</h2>
        <ContentGenerator products={products.map((p) => ({ id: p.id, title: p.title }))} storeId={store.id} />
      </div>
    </AppShell>
  );
}
