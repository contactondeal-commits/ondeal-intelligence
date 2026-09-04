import Link from "next/link";
import { FlaskConical, Sparkles } from "lucide-react";
import type { ResolvedStore } from "@/lib/store-context";
import { prisma } from "@/lib/db";
import { hasFeature } from "@/lib/plan-limits";
import Sidebar, { type NavGroup } from "@/components/Sidebar";
import CommandBar from "@/components/CommandBar";

// Navigation (direction produit 03/09/2026) : COMMAND CENTER / BUSINESS / AI /
// SYSTEM. Les compteurs sont RÉELS (recommandations urgentes, opportunités,
// décisions en attente) — calculés côté serveur à chaque rendu.
const NAV_GROUPS_SOURCE: Array<{ label: string; items: Array<{ key: string; href: string; label: string; feature?: string; count?: "urgent" | "opportunity" | "pending" }> }> = [
  {
    label: "Command Center",
    items: [
      { key: "/dashboard", href: "/dashboard", label: "Dashboard" },
      { key: "/intelligence", href: "/intelligence", label: "Centre d'intelligence" },
      { key: "/intelligence?filter=urgent", href: "/intelligence?filter=urgent", label: "Signaux", count: "urgent" },
      { key: "/intelligence?filter=opportunity", href: "/intelligence?filter=opportunity", label: "Opportunités", count: "opportunity" },
    ],
  },
  {
    label: "Business",
    items: [
      { key: "/products", href: "/products", label: "Produits" },
      { key: "/stock", href: "/stock", label: "Stock" },
      { key: "/reviews", href: "/reviews", label: "Avis" },
      { key: "/pricing", href: "/pricing", label: "Prix & Marge", feature: "pricing" },
      { key: "/marketing", href: "/marketing", label: "Marketing", feature: "marketing" },
    ],
  },
  {
    label: "AI",
    items: [
      { key: "/assistant", href: "/assistant", label: "OnDeal AI", feature: "assistant" },
      { key: "/actions", href: "/actions", label: "Actions", count: "pending" },
    ],
  },
  {
    label: "System",
    items: [
      { key: "/guide", href: "/guide", label: "Guide" },
      { key: "/audit-log", href: "/audit-log", label: "Historique" },
      { key: "/settings", href: "/settings", label: "Paramètres" },
    ],
  },
];

const FLAT_NAV = NAV_GROUPS_SOURCE.flatMap((g) => g.items.filter((i) => !i.href.includes("?")).map((i) => ({ href: i.href, label: i.label, group: g.label })));

function timeAgo(date: Date): string {
  const min = Math.floor((Date.now() - date.getTime()) / 60000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h`;
  return `il y a ${Math.floor(h / 24)} j`;
}

export default async function AppShell({
  store,
  active,
  children,
  headerExtra,
}: {
  store: ResolvedStore;
  active: string;
  children: React.ReactNode;
  /** Contenu additionnel affiché à droite du header (ex: bouton de synchronisation) */
  headerExtra?: React.ReactNode;
}) {
  const [severities, pendingDecisions, user, planLimit, productCount, lastSync] = await Promise.all([
    prisma.recommendation.groupBy({ by: ["severity"], where: { storeId: store.id, status: "OPEN" }, _count: true }),
    prisma.actionItem.count({ where: { storeId: store.id, status: { in: ["PENDING_VALIDATION", "CONFIRMED"] } } }),
    prisma.user.findUnique({ where: { id: store.userId }, select: { name: true } }),
    prisma.planLimit.findUnique({ where: { plan: store.plan as "STARTER" | "PRO" | "BUSINESS" | "AGENCY" } }),
    prisma.product.count({ where: { storeId: store.id } }),
    prisma.syncRun.findFirst({ where: { storeId: store.id, provider: "SHOPIFY", status: { in: ["success", "partial"] } }, orderBy: { startedAt: "desc" }, select: { finishedAt: true, triggeredBy: true } }),
  ]);
  const countOf = (s: string) => severities.find((x) => x.severity === s)?._count ?? 0;
  const counts = { urgent: countOf("URGENT"), opportunity: countOf("OPPORTUNITY"), pending: pendingDecisions };

  const groups: NavGroup[] = NAV_GROUPS_SOURCE.map((g) => ({
    label: g.label,
    items: g.items.map((i) => ({
      key: i.key,
      href: i.href,
      label: i.label,
      enabled: !i.feature || hasFeature(store.plan, i.feature),
      count: i.count ? counts[i.count] : undefined,
      countTone: i.count === "urgent" ? "danger" : i.count === "pending" ? "warning" : "neutral",
    })),
  }));

  const storeStatus = store.isDemo
    ? { label: "Démonstration", tone: "warn" as const }
    : store.integrations.shopifyConnected
      ? { label: "Connectée", tone: "ok" as const }
      : { label: "Non connectée", tone: "off" as const };

  const syncedAt = store.integrations.lastSyncedAt ?? lastSync?.finishedAt ?? null;
  const syncLabel = store.isDemo
    ? "Données de démonstration"
    : store.integrations.shopifyConnected
      ? syncedAt
        ? `Synchronisé ${timeAgo(syncedAt)}`
        : "Jamais synchronisé"
      : syncedAt
        ? `Import ${timeAgo(syncedAt)} · non connecté`
        : "Non connecté";

  const roleLabel: Record<string, string> = { OWNER: "Owner", ADMIN: "Admin", ANALYST: "Analyste", VIEWER: "Lecteur" };

  return (
    <div className="shell">
      <Sidebar
        groups={groups}
        active={active}
        storeId={store.id}
        storeName={store.name}
        storeStatus={storeStatus}
        plan={store.plan}
        planUsage={{ used: productCount, max: planLimit?.maxProducts ?? null }}
        organizationName={store.organizationName}
        stores={store.allStores}
        user={{ name: user?.name ?? "Utilisateur", role: roleLabel[store.role] ?? store.role }}
      />
      <main className="main">
        <div className="app-header">
          <CommandBar navItems={FLAT_NAV} storeId={store.id} canSync={!store.isDemo && (store.integrations.shopifyConnected || store.integrations.judgemeConnected)} />
          <div className="header-right">
            <span className={`sync-status is-${store.isDemo ? "warn" : store.integrations.shopifyConnected ? "ok" : "off"}`} title={syncedAt ? syncedAt.toLocaleString("fr-FR") : undefined}>
              <span className="status-dot" aria-hidden="true" />
              <span className="sync-status-body">
                <span className="sync-status-label">{syncLabel}</span>
                {syncedAt && <span className="sync-status-date">{syncedAt.toLocaleString("fr-FR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span>}
              </span>
            </span>
            {headerExtra}
            {hasFeature(store.plan, "assistant") && (
              <Link href={`/assistant?store=${store.id}`} className="ai-button">
                <Sparkles size={14} aria-hidden="true" /> AI
              </Link>
            )}
          </div>
        </div>

        {store.isDemo && (
          <div className="callout callout-warning" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <FlaskConical size={16} style={{ flexShrink: 0 }} />
            <span>
              <strong>Données de démonstration</strong> — cette boutique contient des données fictives, à but d&apos;exploration uniquement. Elles ne
              sont jamais mélangées à une boutique réelle.
            </span>
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
