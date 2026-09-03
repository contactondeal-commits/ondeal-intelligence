import { requireStore } from "@/lib/store-context";
import { prisma } from "@/lib/db";
import AppShell from "@/components/AppShell";
import RecommendationCard from "@/components/RecommendationCard";

export default async function IntelligencePage({ searchParams }: { searchParams: Promise<{ store?: string }> }) {
  const store = await requireStore(await searchParams);

  const recommendations = await prisma.recommendation.findMany({
    where: { storeId: store.id, status: "OPEN" },
    include: { product: true },
    orderBy: [{ severity: "asc" }, { confidence: "desc" }],
  });

  const urgent = recommendations.filter((r) => r.severity === "URGENT");
  const opportunity = recommendations.filter((r) => r.severity === "OPPORTUNITY");
  const suggestion = recommendations.filter((r) => r.severity === "SUGGESTION");

  return (
    <AppShell store={store} active="/intelligence">
      <div className="topbar">
        <div>
          <h1 className="page-title">Centre d'intelligence</h1>
          <p className="page-subtitle">Problèmes urgents, opportunités et recommandations — dérivés de vos données réelles.</p>
        </div>
      </div>

      <Section title={`🔴 Problèmes urgents (${urgent.length})`} items={urgent} storeId={store.id} empty="Aucun problème urgent détecté." />
      <Section title={`🟠 Opportunités (${opportunity.length})`} items={opportunity} storeId={store.id} empty="Aucune opportunité détectée pour le moment." />
      <Section title={`🟢 Recommandations (${suggestion.length})`} items={suggestion} storeId={store.id} empty="Aucune recommandation en attente." />
    </AppShell>
  );
}

function Section({
  title,
  items,
  storeId,
  empty,
}: {
  title: string;
  items: Array<{ id: string; category: string; severity: "URGENT" | "OPPORTUNITY" | "SUGGESTION"; title: string; reason: string; impact: string; confidence: number; actionLabel: string | null; actionType: string | null; product: { id: string; title: string } | null }>;
  storeId: string;
  empty: string;
}) {
  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 12 }}>{title}</h2>
      {items.length === 0 ? <p className="unavailable-note">{empty}</p> : items.map((r) => <RecommendationCard key={r.id} rec={r} storeId={storeId} />)}
    </div>
  );
}
