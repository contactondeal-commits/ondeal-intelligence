import { requireStore } from "@/lib/store-context";
import { prisma } from "@/lib/db";
import AppShell from "@/components/AppShell";
import MetricCard from "@/components/MetricCard";
import RecommendationCard from "@/components/RecommendationCard";
import SyncButton from "@/components/SyncButton";
import Link from "next/link";

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ store?: string }> }) {
  const store = await requireStore(await searchParams);

  const [productCount, integrations, reviews, recommendations, latestScores, variants] = await Promise.all([
    prisma.product.count({ where: { storeId: store.id } }),
    prisma.integration.findMany({ where: { storeId: store.id } }),
    prisma.review.findMany({ where: { storeId: store.id } }),
    prisma.recommendation.findMany({ where: { storeId: store.id, status: "OPEN" }, include: { product: true }, orderBy: { confidence: "desc" }, take: 6 }),
    prisma.scoreSnapshot.findMany({ where: { storeId: store.id }, orderBy: { computedAt: "desc" }, take: 500 }),
    prisma.variant.findMany({ where: { product: { storeId: store.id } } }),
  ]);

  const shopifyConnected = integrations.find((i) => i.provider === "SHOPIFY")?.status === "CONNECTED";
  const judgemeConnected = integrations.find((i) => i.provider === "JUDGEME")?.status === "CONNECTED";

  const avgRating = reviews.length > 0 ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : null;

  const anyStockKnown = variants.some((v) => v.inventoryQuantity !== null);
  const ruptureCount = new Set(
    variants.filter((v) => v.inventoryQuantity === 0).map((v) => v.productId),
  ).size;

  const revenue30d = await prisma.salesSnapshot.aggregate({
    where: { product: { storeId: store.id }, date: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
    _sum: { revenue: true, unitsSold: true },
  });
  const hasSalesData = revenue30d._sum.unitsSold !== null && revenue30d._sum.unitsSold > 0;

  const latestScoreByProduct = new Map<string, number>();
  for (const s of latestScores) {
    if (!latestScoreByProduct.has(s.productId)) latestScoreByProduct.set(s.productId, s.score);
  }
  const avgScore =
    latestScoreByProduct.size > 0
      ? Math.round([...latestScoreByProduct.values()].reduce((a, b) => a + b, 0) / latestScoreByProduct.size)
      : null;

  const opportunities = recommendations.filter((r) => r.severity === "OPPORTUNITY").length;

  return (
    <AppShell store={store} active="/dashboard">
      <div className="topbar">
        <div>
          <h1 className="page-title">Dashboard — {store.name}</h1>
          <p className="page-subtitle">Vue d'ensemble : ce qui se passe, ce qui ne va pas, ce qu'il y a à faire.</p>
        </div>
        {!store.isDemo && <SyncButton storeId={store.id} shopifyConnected={shopifyConnected} judgemeConnected={judgemeConnected} />}
      </div>

      {(!shopifyConnected || !judgemeConnected) && !store.isDemo && (
        <div className="callout callout-info">
          {!shopifyConnected && "Shopify n'est pas connecté. "}
          {!judgemeConnected && "Judge.me n'est pas connecté. "}
          <Link href={`/settings/integrations?store=${store.id}`} style={{ fontWeight: 700, textDecoration: "underline" }}>
            Connecter maintenant
          </Link>{" "}
          pour activer les métriques réelles ci-dessous.
        </div>
      )}

      <div className="grid grid-4" style={{ marginBottom: 20 }}>
        <MetricCard label="Chiffre d'affaires (30j)" value={hasSalesData ? `${revenue30d._sum.revenue?.toFixed(2)} €` : null} />
        <MetricCard label="Commandes / unités vendues (30j)" value={hasSalesData ? String(revenue30d._sum.unitsSold) : null} />
        <MetricCard label="Produits synchronisés" value={productCount > 0 ? String(productCount) : null} />
        <MetricCard label="OnDeal Score moyen" value={avgScore !== null ? `${avgScore}/100` : null} />
        <MetricCard label="Note moyenne avis" value={avgRating !== null ? `${avgRating.toFixed(2)}/5 (${reviews.length} avis)` : null} />
        <MetricCard label="Produits sans avis" value={productCount > 0 ? String(productCount - new Set(reviews.map((r) => r.productId)).size) : null} />
        <MetricCard label="Ruptures de stock" value={anyStockKnown ? String(ruptureCount) : null} />
        <MetricCard label="Opportunités détectées" value={String(opportunities)} available />
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 14 }}>Priorités actuelles</h2>
        {recommendations.length === 0 ? (
          <p className="unavailable-note">
            Aucune recommandation pour le moment — synchronisez vos données pour lancer la première analyse.
          </p>
        ) : (
          recommendations.map((r) => <RecommendationCard key={r.id} rec={r} storeId={store.id} />)
        )}
        <Link href={`/intelligence?store=${store.id}`} style={{ fontSize: 13.5, fontWeight: 700, color: "#4f46e5" }}>
          Voir toutes les recommandations →
        </Link>
      </div>
    </AppShell>
  );
}
