import { requireStore } from "@/lib/store-context";
import { prisma } from "@/lib/db";
import AppShell from "@/components/AppShell";
import { hasFeature } from "@/lib/plan-limits";

const FILTERS: Array<{ key: string; label: string; match: (event: string) => boolean }> = [
  { key: "all", label: "Tout", match: () => true },
  { key: "sync", label: "Synchronisations", match: (e) => e.startsWith("sync.") },
  { key: "intelligence", label: "IA & Intelligence", match: (e) => e.startsWith("intelligence.") || e.startsWith("recommendation.") || e.startsWith("assistant.") },
  { key: "actions", label: "Actions", match: (e) => e.startsWith("action.") },
  { key: "settings", label: "Paramètres & Intégrations", match: (e) => e.startsWith("integration.") || e.startsWith("cost_assumption.") || e.startsWith("store.") },
];

const EVENT_DOT: Record<string, string> = {
  "sync.completed": "success",
  "sync.failed": "danger",
  "action.executed": "success",
  "action.failed": "danger",
  "recommendation.dismissed": "neutral",
};

export default async function AuditLogPage({ searchParams }: { searchParams: Promise<{ store?: string; filter?: string }> }) {
  const params = await searchParams;
  const store = await requireStore(params);

  // VERROU DE PLAN CÔTÉ SERVEUR (audit conformité 05/09/2026) — "Historique"
  // est présenté dans Paramètres comme réservé BUSINESS/AGENCY, mais la page
  // n'appliquait jusqu'ici aucune vérification serveur (accessible à tout
  // plan connaissant l'URL). Repli visuel plutôt qu'un blocage brutal.
  if (!hasFeature(store.plan, "audit_log")) {
    return (
      <AppShell store={store} active="/audit-log">
        <h1 className="page-title">Historique</h1>
        <div className="card">
          <p className="unavailable-note">
            L&apos;historique complet des événements est disponible avec le plan BUSINESS et supérieur. Passez à un plan
            supérieur depuis Paramètres pour y accéder.
          </p>
        </div>
      </AppShell>
    );
  }

  const activeFilter = FILTERS.some((f) => f.key === params.filter) ? params.filter! : "all";

  const logs = await prisma.auditLog.findMany({
    where: { storeId: store.id },
    include: { user: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  const activeMatch = FILTERS.find((f) => f.key === activeFilter)!.match;
  const filtered = logs.filter((l) => activeMatch(l.event));

  return (
    <AppShell store={store} active="/audit-log">
      <h1 className="page-title">Historique</h1>
      <p className="page-subtitle" style={{ marginBottom: 18 }}>Journal d&apos;activité complet — comprendre ce que l&apos;application a fait, et pourquoi.</p>

      <div className="filter-tabs">
        {FILTERS.map((f) => (
          <a key={f.key} href={`?store=${store.id}${f.key === "all" ? "" : `&filter=${f.key}`}`} className={`filter-tab ${activeFilter === f.key ? "active" : ""}`}>
            {f.label} ({logs.filter((l) => f.match(l.event)).length})
          </a>
        ))}
      </div>

      <div className="card">
        {filtered.length === 0 ? (
          <p className="unavailable-note">Aucun événement dans cette catégorie.</p>
        ) : (
          <div className="timeline">
            {filtered.map((l) => (
              <div className="timeline-item" key={l.id}>
                <span className={`timeline-dot ${EVENT_DOT[l.event] ?? "neutral"}`} />
                <div className="timeline-time">{l.createdAt.toLocaleString("fr-FR")}</div>
                <div className="timeline-title">
                  {l.user?.name ?? (l.actorType === "system" ? "Système" : "Utilisateur")} —{" "}
                  <span className="badge badge-neutral">{l.event}</span>
                </div>
                <div className="timeline-detail">{l.message}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
