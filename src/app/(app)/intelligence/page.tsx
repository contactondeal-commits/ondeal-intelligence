import Link from "next/link";
import { requireStore } from "@/lib/store-context";
import { prisma } from "@/lib/db";
import AppShell from "@/components/AppShell";
import DecisionCard from "@/components/DecisionCard";
import Pagination from "@/components/ui/Pagination";
import TableControls from "@/components/ui/TableControls";
import DataTag from "@/components/ui/DataTag";
import { parsePageParams, withParams } from "@/lib/pagination";
import { groupRecommendations, countBySeverity, type GroupableRecommendation, type RecommendationGroup } from "@/lib/intelligence/group";
import { lightenGroup } from "@/lib/intelligence/groupTransport";

const CATEGORY_LABEL: Record<string, string> = {
  margin: "Marge",
  stock: "Stock",
  reviews: "Preuve sociale",
  data_quality: "Qualité des données",
  content: "Contenu produit",
  marketing: "Marketing",
};
const CATEGORY_OPTIONS = [{ value: "all", label: "Toutes les catégories" }, ...Object.entries(CATEGORY_LABEL).map(([value, label]) => ({ value, label }))];
const SEVERITY_OPTIONS = [
  { value: "all", label: "Toutes les sévérités" },
  { value: "urgent", label: "Risques (urgent)" },
  { value: "opportunity", label: "Opportunités" },
  { value: "suggestion", label: "Recommandations" },
];

type Params = { store?: string; filter?: string; category?: string; q?: string; page?: string; pageSize?: string };

/**
 * CENTRE D'INTELLIGENCE / OPPORTUNITÉS — direction produit 03/09/2026 :
 * onglets par catégorie (filtres réels), tuiles réelles, liste de décisions
 * repliées (même composant que le Command Center : signal → scénario →
 * validation → action), rail droit avec la répartition réelle par catégorie
 * et les filtres. Aucun impact en euros n'est affiché : il n'est pas
 * calculable honnêtement sans volume de ventes.
 */
export default async function IntelligencePage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const store = await requireStore(params);
  const activeFilter = params.filter === "urgent" || params.filter === "opportunity" || params.filter === "suggestion" ? params.filter : "all";
  const category = CATEGORY_OPTIONS.some((o) => o.value === params.category) ? (params.category as string) : "all";
  const { page, pageSize } = parsePageParams(params, 20);

  const recommendations: GroupableRecommendation[] = await prisma.recommendation.findMany({
    where: { storeId: store.id, status: "OPEN" },
    include: { product: { select: { id: true, title: true } } },
    orderBy: [{ severity: "asc" }, { confidence: "desc" }],
  });

  const counts = countBySeverity(recommendations);
  const allGroups = groupRecommendations(recommendations);
  const productsConcerned = new Set(recommendations.map((r) => r.product?.id).filter(Boolean)).size;
  const byCategory = Object.keys(CATEGORY_LABEL).map((c) => ({ key: c, label: CATEGORY_LABEL[c]!, count: recommendations.filter((r) => r.category === c).length }));
  const maxCat = Math.max(1, ...byCategory.map((c) => c.count));

  const q = params.q?.trim().toLowerCase();
  let filtered = recommendations;
  if (activeFilter !== "all") filtered = filtered.filter((r) => r.severity === activeFilter.toUpperCase());
  if (category !== "all") filtered = filtered.filter((r) => r.category === category);
  if (q) filtered = filtered.filter((r) => r.title.toLowerCase().includes(q) || (r.product?.title ?? "").toLowerCase().includes(q));
  const groups: RecommendationGroup[] = activeFilter === "all" && category === "all" && !q ? allGroups : groupRecommendations(filtered);
  const total = groups.length;
  const pageGroups = groups.slice((page - 1) * pageSize, page * pageSize);

  // Reprise d'état : décision déjà engagée sur les recommandations affichées.
  const pageItemIds = pageGroups.flatMap((g) => g.items.map((i) => i.id));
  const [existingActions, decisionsEngaged] = await Promise.all([
    pageItemIds.length ? prisma.actionItem.findMany({ where: { storeId: store.id, recommendationId: { in: pageItemIds } }, orderBy: { createdAt: "desc" } }) : Promise.resolve([]),
    prisma.actionItem.count({ where: { storeId: store.id, status: { in: ["PENDING_VALIDATION", "CONFIRMED"] } } }),
  ]);
  const latestByRec = new Map<string, (typeof existingActions)[number]>();
  for (const a of existingActions) if (a.recommendationId && !latestByRec.has(a.recommendationId)) latestByRec.set(a.recommendationId, a);
  const actionsByRecommendation: Record<string, { id: string; type: string; sensitivity: "SENSITIVE" | "SAFE"; status: (typeof existingActions)[number]["status"]; payload: Record<string, unknown>; resultJson: string | null; createdAt: string; confirmedAt: string | null; executedAt: string | null }> = {};
  for (const [recId, a] of latestByRec) {
    actionsByRecommendation[recId] = {
      id: a.id,
      type: a.type,
      sensitivity: a.sensitivity as "SENSITIVE" | "SAFE",
      status: a.status,
      payload: JSON.parse(a.payloadJson) as Record<string, unknown>,
      resultJson: a.resultJson,
      createdAt: a.createdAt.toISOString(),
      confirmedAt: a.confirmedAt?.toISOString() ?? null,
      executedAt: a.executedAt?.toISOString() ?? null,
    };
  }

  const urlParams: Record<string, string | undefined> = { store: store.id, filter: activeFilter === "all" ? undefined : activeFilter, category: category === "all" ? undefined : category, q: params.q, pageSize: params.pageSize };
  const title = activeFilter === "urgent" ? "Signaux" : activeFilter === "opportunity" ? "Opportunités" : "Centre d'intelligence";
  const activeKey = activeFilter === "urgent" || activeFilter === "opportunity" ? `/intelligence?filter=${activeFilter}` : "/intelligence";

  return (
    <AppShell store={store} active={activeKey}>
      <div className="topbar">
        <div>
          <h1 className="page-title">{title}</h1>
          <p className="page-subtitle">
            {counts.total.toLocaleString("fr-FR")} recommandation{counts.total > 1 ? "s" : ""} réelle{counts.total > 1 ? "s" : ""} sur vos données, regroupées en{" "}
            {allGroups.length.toLocaleString("fr-FR")} priorité{allGroups.length > 1 ? "s" : ""} par produit.
          </p>
        </div>
      </div>

      <nav className="segment-tabs" aria-label="Catégories">
        {CATEGORY_OPTIONS.map((c) => (
          <Link key={c.value} href={`/intelligence${withParams(urlParams, { category: c.value === "all" ? undefined : c.value, page: undefined })}`} className={`segment-tab${category === c.value ? " is-active" : ""}`} aria-current={category === c.value ? "page" : undefined}>
            {c.value === "all" ? "Toutes" : c.label}
          </Link>
        ))}
      </nav>

      <div className="stat-strip" role="list">
        <Tile label="Signaux ouverts" value={counts.total} tag="calculated" />
        <Tile label="Risques urgents" value={counts.urgent} tag="calculated" tone={counts.urgent > 0 ? "danger" : undefined} />
        <Tile label="Opportunités" value={counts.opportunity} tag="calculated" />
        <Tile label="Produits concernés" value={productsConcerned} tag="real" />
        <Tile label="Décisions engagées" value={decisionsEngaged} tag="real" tone={decisionsEngaged > 0 ? "warning" : undefined} />
      </div>

      <div className="intel-grid">
        <div className="card card-table">
          <TableControls params={urlParams} searchPlaceholder="Rechercher une recommandation ou un produit" filters={[{ key: "filter", label: "Sévérité", value: activeFilter, options: SEVERITY_OPTIONS }]} />
          {pageGroups.length === 0 ? (
            <p className="unavailable-note" style={{ padding: 16 }}>
              Aucune recommandation ne correspond à ces critères.
            </p>
          ) : (
            <div className="priority-list">
              {pageGroups.map((g) => (
                <DecisionCard key={g.key} group={lightenGroup(g, 3)} storeId={store.id} existingAction={actionsByRecommendation[g.representative.id] ?? null} actionsByRecommendation={actionsByRecommendation} defaultCollapsed />
              ))}
            </div>
          )}
          <Pagination total={total} page={page} pageSize={pageSize} params={urlParams} label="priorités" />
        </div>

        <aside className="intel-rail">
          <section className="card cc-card" aria-labelledby="intel-split">
            <h2 id="intel-split" className="cc-card-title">
              Répartition par catégorie
            </h2>
            <ul className="split-list">
              {byCategory.map((c) => (
                <li key={c.key} className="split-item">
                  <div className="split-head">
                    <Link href={`/intelligence${withParams(urlParams, { category: c.key, page: undefined })}`}>{c.label}</Link>
                    <span>
                      {c.count.toLocaleString("fr-FR")} <span className="cell-sub">({counts.total ? Math.round((c.count / counts.total) * 100) : 0} %)</span>
                    </span>
                  </div>
                  <div className="split-bar" aria-hidden="true">
                    <span className={`split-fill split-fill-${c.key}`} style={{ width: `${(c.count / maxCat) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
            <p className="cell-sub">
              <DataTag status="unavailable" compact /> Aucun impact en euros n&apos;est estimé : le volume de ventes ne le permet pas encore.
            </p>
          </section>
          <section className="card cc-card" aria-labelledby="intel-filters">
            <h2 id="intel-filters" className="cc-card-title">
              Filtres
            </h2>
            <div className="rail-filters">
              <span className="cell-sub">Sévérité</span>
              <div className="rail-chips">
                {SEVERITY_OPTIONS.map((o) => (
                  <Link key={o.value} href={`/intelligence${withParams(urlParams, { filter: o.value === "all" ? undefined : o.value, page: undefined })}`} className={`rail-chip${activeFilter === o.value ? " is-active" : ""}`}>
                    {o.label}
                  </Link>
                ))}
              </div>
              {(activeFilter !== "all" || category !== "all" || q) && (
                <Link href={`/intelligence?store=${store.id}`} className="section-link">
                  Réinitialiser
                </Link>
              )}
            </div>
          </section>
        </aside>
      </div>
    </AppShell>
  );
}

function Tile({ label, value, tag, tone }: { label: string; value: number; tag: "real" | "calculated" | "estimated" | "unavailable"; tone?: "danger" | "warning" }) {
  return (
    <div className={`stat-tile${tone ? ` stat-tile-${tone}` : ""}`} role="listitem">
      <div className="stat-tile-label">
        {label} <DataTag status={tag} compact />
      </div>
      <div className="stat-tile-value">{value.toLocaleString("fr-FR")}</div>
    </div>
  );
}
