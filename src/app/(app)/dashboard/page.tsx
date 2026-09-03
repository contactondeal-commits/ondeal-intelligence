import { requireStore } from "@/lib/store-context";
import { prisma } from "@/lib/db";
import AppShell from "@/components/AppShell";
import MetricCard from "@/components/MetricCard";
import PriorityCard from "@/components/PriorityCard";
import SyncButton from "@/components/SyncButton";
import HealthRing from "@/components/HealthRing";
import Link from "next/link";
import { groupRecommendations, countBySeverity } from "@/lib/intelligence/group";
import { aggregateScoreBreakdowns } from "@/lib/intelligence/score";
import type { ScoreBreakdown } from "@/types";

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Bonjour";
  if (h < 18) return "Bon après-midi";
  return "Bonsoir";
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ store?: string }> }) {
  const store = await requireStore(await searchParams);

  const [productCount, integrations, reviews, recommendations, latestScores, variants] = await Promise.all([
    prisma.product.count({ where: { storeId: store.id } }),
    prisma.integration.findMany({ where: { storeId: store.id } }),
    prisma.review.findMany({ where: { storeId: store.id } }),
    prisma.recommendation.findMany({ where: { storeId: store.id, status: "OPEN" }, include: { product: true }, orderBy: { confidence: "desc" } }),
    prisma.scoreSnapshot.findMany({ where: { storeId: store.id }, orderBy: { computedAt: "desc" }, take: 500 }),
    prisma.variant.findMany({ where: { product: { storeId: store.id } } }),
  ]);

  const shopifyConnected = integrations.find((i) => i.provider === "SHOPIFY")?.status === "CONNECTED";
  const judgemeConnected = integrations.find((i) => i.provider === "JUDGEME")?.status === "CONNECTED";

  const avgRating = reviews.length > 0 ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : null;

  const anyStockKnown = variants.some((v) => v.inventoryQuantity !== null);
  const ruptureCount = new Set(variants.filter((v) => v.inventoryQuantity === 0).map((v) => v.productId)).size;

  const revenue30d = await prisma.salesSnapshot.aggregate({
    where: { product: { storeId: store.id }, date: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
    _sum: { revenue: true, unitsSold: true },
  });
  const hasSalesData = revenue30d._sum.unitsSold !== null && revenue30d._sum.unitsSold > 0;

  // Un seul snapshot (le plus récent) par produit — on ne garde que ceux-là
  // pour le score moyen ET pour l'explication agrégée du health score.
  const latestScoreByProduct = new Map<string, (typeof latestScores)[number]>();
  for (const s of latestScores) {
    if (!latestScoreByProduct.has(s.productId)) latestScoreByProduct.set(s.productId, s);
  }
  const latestSnapshots = [...latestScoreByProduct.values()];
  const avgScore =
    latestSnapshots.length > 0
      ? Math.round(latestSnapshots.reduce((a, s) => a + s.score, 0) / latestSnapshots.length)
      : null;

  const breakdowns: ScoreBreakdown[] = [];
  for (const s of latestSnapshots) {
    try {
      breakdowns.push(JSON.parse(s.factorsJson) as ScoreBreakdown);
    } catch {
      // factorsJson corrompu/absent pour ce snapshot — on l'exclut simplement,
      // jamais de valeur inventée à la place.
    }
  }
  const scoreExplanation = aggregateScoreBreakdowns(breakdowns);
  const avgDataCompleteness =
    breakdowns.length > 0 ? Math.round(breakdowns.reduce((a, b) => a + b.dataCompleteness, 0) / breakdowns.length) : null;

  const severityCounts = countBySeverity(recommendations);
  const groups = groupRecommendations(recommendations).slice(0, 5);

  return (
    <AppShell
      store={store}
      active="/dashboard"
      headerExtra={!store.isDemo ? <SyncButton storeId={store.id} shopifyConnected={shopifyConnected} judgemeConnected={judgemeConnected} /> : undefined}
    >
      <div className="hero-health">
        <div className="hero-health-body">
          <h1 className="hero-health-greeting">
            {greeting()} — {store.name}
          </h1>
          <p className="hero-health-subtitle">
            {severityCounts.total === 0
              ? "Aucun problème détecté sur vos données actuelles. Continuez à synchroniser pour garder ce niveau."
              : `${severityCounts.urgent} problème${severityCounts.urgent > 1 ? "s" : ""} urgent${severityCounts.urgent > 1 ? "s" : ""}, ${severityCounts.opportunity} opportunité${severityCounts.opportunity > 1 ? "s" : ""} et ${severityCounts.suggestion} recommandation${severityCounts.suggestion > 1 ? "s" : ""} détectés sur vos données réelles.`}
          </p>
          <div className="hero-health-stats">
            <div>
              <div className="hero-health-stat-label">Produits suivis</div>
              <div className="hero-health-stat-value">{productCount > 0 ? productCount : "—"}</div>
            </div>
            <div>
              <div className="hero-health-stat-label">Complétude des données</div>
              <div className="hero-health-stat-value">{avgDataCompleteness !== null ? `${avgDataCompleteness}%` : "N/D"}</div>
            </div>
            <div>
              <div className="hero-health-stat-label">Ruptures de stock</div>
              <div className="hero-health-stat-value">{anyStockKnown ? ruptureCount : "N/D"}</div>
            </div>
          </div>
        </div>
        <HealthRing score={avgScore} />
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
        <MetricCard label="Note moyenne avis" value={avgRating !== null ? `${avgRating.toFixed(2)}/5 (${reviews.length} avis)` : null} />
        <MetricCard label="Produits sans avis" value={productCount > 0 ? String(productCount - new Set(reviews.map((r) => r.productId)).size) : null} />
      </div>

      <div className="grid grid-2" style={{ marginBottom: 20, alignItems: "start" }}>
        <div className="card">
          <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 4 }}>Priorités du jour</h2>
          <p className="unavailable-note" style={{ marginBottom: 14 }}>
            {severityCounts.total > groups.length
              ? `${severityCounts.total} recommandations réelles, regroupées ici par produit — rien n'est masqué.`
              : "Regroupées automatiquement par produit."}
          </p>
          {groups.length === 0 ? (
            <p className="unavailable-note">Aucune recommandation pour le moment — synchronisez vos données pour lancer la première analyse.</p>
          ) : (
            groups.map((g) => <PriorityCard key={g.key} group={g} storeId={store.id} />)
          )}
          <Link href={`/intelligence?store=${store.id}`} style={{ fontSize: 13.5, fontWeight: 700, color: "var(--color-primary)" }}>
            Voir les {severityCounts.total} recommandations →
          </Link>
        </div>

        <div className="card">
          <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 4 }}>Pourquoi ce score ?</h2>
          <p className="unavailable-note" style={{ marginBottom: 14 }}>
            Contribution moyenne réelle de chaque facteur, sur {latestSnapshots.length} produit{latestSnapshots.length > 1 ? "s" : ""} scoré{latestSnapshots.length > 1 ? "s" : ""}.
          </p>
          {scoreExplanation.length === 0 ? (
            <p className="unavailable-note">Aucun score calculé pour le moment — synchronisez vos données.</p>
          ) : (
            scoreExplanation.map((f) => (
              <div className="score-factor-row" key={f.key}>
                <div className="score-factor-label">{f.label}</div>
                <div className="score-factor-bar-track">
                  <div className="score-factor-bar-fill" style={{ width: `${Math.max(0, Math.min(100, (f.avgContribution / 30) * 100))}%` }} />
                </div>
                <div className="score-factor-contribution">{f.avgContribution} pt</div>
              </div>
            ))
          )}
        </div>
      </div>
    </AppShell>
  );
}
