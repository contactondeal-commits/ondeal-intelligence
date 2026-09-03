import Link from "next/link";
import type { ResolvedStore } from "@/lib/store-context";
import { hasFeature } from "@/lib/plan-limits";
import StoreSwitcher from "@/components/StoreSwitcher";
import LogoutButton from "@/components/LogoutButton";

const NAV_ITEMS: Array<{ href: string; label: string; icon: string; feature?: string }> = [
  { href: "/dashboard", label: "Dashboard", icon: "📊" },
  { href: "/intelligence", label: "Centre d'intelligence", icon: "🧠" },
  { href: "/products", label: "Product Intelligence", icon: "📦" },
  { href: "/stock", label: "Stock Intelligence", icon: "🚚" },
  { href: "/reviews", label: "Review Intelligence", icon: "⭐" },
  { href: "/pricing", label: "Prix & Marge", icon: "💶", feature: "pricing" },
  { href: "/marketing", label: "Marketing Intelligence", icon: "📣", feature: "marketing" },
  { href: "/assistant", label: "Assistant IA", icon: "🤖", feature: "assistant" },
  { href: "/actions", label: "Actions", icon: "✅" },
  { href: "/audit-log", label: "Historique", icon: "🕓" },
  { href: "/settings", label: "Paramètres", icon: "⚙️" },
];

export default function AppShell({
  store,
  active,
  children,
}: {
  store: ResolvedStore;
  active: string;
  children: React.ReactNode;
}) {
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span>🟣</span> OnDeal Intelligence
        </div>

        <StoreSwitcher currentStoreId={store.id} stores={store.allStores} />

        <div className="sidebar-section-label">Navigation</div>
        {NAV_ITEMS.map((item) => {
          const enabled = !item.feature || hasFeature(store.plan, item.feature);
          return (
            <Link
              key={item.href}
              href={enabled ? `${item.href}?store=${store.id}` : "#"}
              className={`sidebar-link ${active === item.href ? "active" : ""}`}
              style={enabled ? undefined : { opacity: 0.4, cursor: "not-allowed", pointerEvents: "none" }}
              title={enabled ? undefined : `Disponible à partir du plan Pro`}
            >
              <span>{item.icon}</span> {item.label}
            </Link>
          );
        })}

        <div style={{ flex: 1 }} />
        <div style={{ padding: "10px", fontSize: 12, color: "rgba(255,255,255,0.5)" }}>
          Plan {store.plan} — {store.organizationName}
        </div>
        <LogoutButton />
      </aside>
      <main className="main">
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
