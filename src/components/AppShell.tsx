import type { ResolvedStore } from "@/lib/store-context";
import { hasFeature } from "@/lib/plan-limits";
import Sidebar, { type NavGroup } from "@/components/Sidebar";
import StoreStatusPill from "@/components/StoreStatusPill";

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Vue d'ensemble",
    items: [{ href: "/dashboard", label: "Dashboard", icon: "📊" }],
  },
  {
    label: "Intelligence",
    items: [
      { href: "/intelligence", label: "Centre d'intelligence", icon: "🧠" },
      { href: "/products", label: "Product Intelligence", icon: "📦" },
      { href: "/stock", label: "Stock Intelligence", icon: "🚚" },
      { href: "/reviews", label: "Review Intelligence", icon: "⭐" },
    ],
  },
  {
    label: "Croissance",
    items: [
      { href: "/pricing", label: "Prix & Marge", icon: "💶", feature: "pricing" },
      { href: "/marketing", label: "Marketing Intelligence", icon: "📣", feature: "marketing" },
    ],
  },
  {
    label: "IA",
    items: [{ href: "/assistant", label: "Assistant IA", icon: "🤖", feature: "assistant" }],
  },
  {
    label: "Opérations",
    items: [
      { href: "/actions", label: "Actions", icon: "✅" },
      { href: "/audit-log", label: "Historique", icon: "🕓" },
    ],
  },
  {
    label: "Paramètres",
    items: [{ href: "/settings", label: "Paramètres", icon: "⚙️" }],
  },
];

export default function AppShell({
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
  return (
    <div className="shell">
      <Sidebar
        groups={NAV_GROUPS}
        active={active}
        storeId={store.id}
        storeName={store.name}
        plan={store.plan}
        organizationName={store.organizationName}
        stores={store.allStores}
        enabledFeatures={NAV_GROUPS.flatMap(g => g.items).filter(i => !i.feature || hasFeature(store.plan, i.feature)).map(i => i.href)}
      />
      <main className="main">
        <div className="app-header">
          <StoreStatusPill
            shopifyConnected={store.integrations.shopifyConnected}
            judgemeConnected={store.integrations.judgemeConnected}
            lastSyncedAt={store.integrations.lastSyncedAt}
            isDemo={store.isDemo}
          />
          <div className="header-right">{headerExtra}</div>
        </div>

        {store.isDemo && (
          <div className="callout callout-warning">
            🧪 <strong>DONNÉES DE DÉMONSTRATION</strong> — cette boutique contient des données fictives, à but
            d'exploration uniquement. Elles ne sont jamais mélangées à une boutique réelle.
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
