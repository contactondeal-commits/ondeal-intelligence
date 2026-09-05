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

  // Trafic & Acquisition (Google Analytics, 05/09/2026) — lecture directe
  // des agrégats stockés par syncGoogleAnalytics ; page vide et honnête si
  // le connecteur n'est pas encore configuré (jamais de donnée inventée).
  const gaIntegration = await prisma.integration.findUnique({
    where: { storeId_provider: { storeId: store.id, provider: "GOOGLE_ANALYTICS" } },
  });
  const gaConnected = gaIntegration?.status === "CONNECTED";
  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [dailySnapshots, channelSnapshots] = gaConnected
    ? await Promise.all([
        prisma.analyticsSnapshot.findMany({ where: { storeId: store.id, date: { gte: since30d } }, orderBy: { date: "asc" } }),
        prisma.analyticsChannelSnapshot.findMany({ where: { storeId: store.id, date: { gte: since30d } } }),
      ])
    : [[], []];

  const gaTotals = dailySnapshots.reduce(
    (acc, d) => ({ sessions: acc.sessions + d.sessions, conversions: acc.conversions + d.conversions, revenue: acc.revenue + d.revenue }),
    { sessions: 0, conversions: 0, revenue: 0 },
  );
  const channelTotals = new Map<string, { sessions: number; conversions: number; revenue: number }>();
  for (const c of channelSnapshots) {
    const cur = channelTotals.get(c.sourceMedium) ?? { sessions: 0, conversions: 0, revenue: 0 };
    channelTotals.set(c.sourceMedium, { sessions: cur.sessions + c.sessions, conversions: cur.conversions + c.conversions, revenue: cur.revenue + c.revenue });
  }
  const topChannels = [...channelTotals.entries()].sort((a, b) => b[1].sessions - a[1].sessions).slice(0, 8);

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

      <div className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 12 }}>Trafic & Acquisition (Google Analytics)</h2>
        {!gaConnected ? (
          <p className="unavailable-note">
            Connectez Google Analytics depuis{" "}
            <a href={`/settings/integrations?store=${store.id}`} style={{ color: "inherit", fontWeight: 700 }}>
              Paramètres &gt; Intégrations
            </a>{" "}
            pour voir vos sessions, canaux et conversions ici.
          </p>
        ) : dailySnapshots.length === 0 ? (
          <p className="unavailable-note">Google Analytics est connecté — en attente de la première synchronisation.</p>
        ) : (
          <>
            <div className="grid grid-3" style={{ marginBottom: 16 }}>
              <div className="card" style={{ padding: 14 }}>
                <div className="unavailable-note">Sessions (30 j)</div>
                <div style={{ fontWeight: 800, fontSize: 20 }}>{gaTotals.sessions.toLocaleString("fr-FR")}</div>
              </div>
              <div className="card" style={{ padding: 14 }}>
                <div className="unavailable-note">Conversions (30 j)</div>
                <div style={{ fontWeight: 800, fontSize: 20 }}>{gaTotals.conversions.toLocaleString("fr-FR")}</div>
              </div>
              <div className="card" style={{ padding: 14 }}>
                <div className="unavailable-note">Revenu GA4 (30 j)</div>
                <div style={{ fontWeight: 800, fontSize: 20 }}>{gaTotals.revenue.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}</div>
              </div>
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>Canal</th>
                  <th>Sessions</th>
                  <th>Conversions</th>
                  <th>Revenu</th>
                </tr>
              </thead>
              <tbody>
                {topChannels.map(([sourceMedium, t]) => (
                  <tr key={sourceMedium}>
                    <td>{sourceMedium}</td>
                    <td>{t.sessions.toLocaleString("fr-FR")}</td>
                    <td>{t.conversions.toLocaleString("fr-FR")}</td>
                    <td>{t.revenue.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

      <div className="card">
        <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 12 }}>Générateur de contenu (données réelles uniquement)</h2>
        <ContentGenerator products={products.map((p) => ({ id: p.id, title: p.title }))} storeId={store.id} />
      </div>
    </AppShell>
  );
}
