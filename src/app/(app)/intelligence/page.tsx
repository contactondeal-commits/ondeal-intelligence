import { requireStore } from "@/lib/store-context";
import { prisma } from "@/lib/db";
import AppShell from "@/components/AppShell";
import PriorityCard from "@/components/PriorityCard";
import { groupRecommendations, countBySeverity, type GroupableRecommendation } from "@/lib/intelligence/group";

export default async function IntelligencePage({
  searchParams,
}: {
  searchParams: Promise<{ store?: string; filter?: string }>;
}) {
  const params = await searchParams;
  const store = await requireStore(params);
  const activeFilter = params.filter === "urgent" || params.filter === "opportunity" || params.filter === "suggestion" ? params.filter : "all";

  const recommendations: GroupableRecommendation[] = await prisma.recommendation.findMany({
    where: { storeId: store.id, status: "OPEN" },
    include: { product: true },
    orderBy: [{ severity: "asc" }, { confidence: "desc" }],
  });

  const counts = countBySeverity(recommendations);
  const allGroups = groupRecommendations(recommendations);
  const filtered =
    activeFilter === "all"
      ? recommendations
      : recommendations.filter((r) => r.severity === activeFilter.toUpperCase());
  const groups = activeFilter === "all" ? allGroups : groupRecommendations(filtered);

  const chips: Array<{ key: string; label: string; count: number; cls: string }> = [
    { key: "all", label: "Toutes", count: counts.total, cls: "all" },
    { key: "urgent", label: "Urgent", count: counts.urgent, cls: "urgent" },
    { key: "opportunity", label: "Opportunités", count: counts.opportunity, cls: "opportunity" },
    { key: "suggestion", label: "Recommandations", count: counts.suggestion, cls: "suggestion" },
  ];

  return (
    <AppShell store={store} active="/intelligence">
      <div className="topbar">
        <div>
          <h1 className="page-title">Centre d&apos;intelligence</h1>
          <p className="page-subtitle">
            {counts.total} recommandation{counts.total > 1 ? "s" : ""} réelle{counts.total > 1 ? "s" : ""}, regroupées en {allGroups.length} priorité
            {allGroups.length > 1 ? "s" : ""} lisibles.
          </p>
        </div>
      </div>

      <div className="chip-row">
        {chips.map((c) => (
          <a
            key={c.key}
            href={`?store=${store.id}${c.key === "all" ? "" : `&filter=${c.key}`}`}
            className={`count-chip chip-${c.cls} ${activeFilter === c.key ? "active" : ""}`}
          >
            {c.label} <span className="chip-count">{c.count}</span>
          </a>
        ))}
      </div>

      <div className="card">
        {groups.length === 0 ? (
          <p className="unavailable-note">Aucune recommandation dans cette catégorie.</p>
        ) : (
          groups.map((g) => <PriorityCard key={g.key} group={g} storeId={store.id} />)
        )}
      </div>
    </AppShell>
  );
}
