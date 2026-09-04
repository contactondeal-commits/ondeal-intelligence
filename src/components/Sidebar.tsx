"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, ChevronDown } from "lucide-react";
import StoreSwitcher from "@/components/StoreSwitcher";
import LogoutButton from "@/components/LogoutButton";
import { NAV_ICONS } from "@/components/icons";
import LogoMark from "@/components/Logo";

export interface NavItem {
  /** Clé stable d'activation (ex. "/intelligence?filter=urgent"). */
  key: string;
  href: string;
  label: string;
  /** Résolu côté serveur (plan de l'organisation) — jamais une fonction, pour rester sérialisable vers ce Client Component. */
  enabled: boolean;
  /** Compteur RÉEL (recommandations urgentes, opportunités, décisions en attente) — jamais un chiffre décoratif. */
  count?: number;
  countTone?: "danger" | "warning" | "neutral";
}
export interface NavGroup {
  label: string;
  items: NavItem[];
}

const COLLAPSE_KEY = "ondeal.sidebar.collapsed";
const GROUPS_KEY = "ondeal.sidebar.closedGroups";

export default function Sidebar({
  groups,
  active,
  storeId,
  storeName,
  storeStatus,
  plan,
  planUsage,
  organizationName,
  stores,
  user,
}: {
  groups: NavGroup[];
  active: string;
  storeId: string;
  storeName: string;
  storeStatus: { label: string; tone: "ok" | "warn" | "off" };
  plan: string;
  /** Utilisation réelle du plan : produits synchronisés / limite du plan (null si aucune limite configurée). */
  planUsage: { used: number; max: number | null };
  organizationName: string;
  stores: Array<{ id: string; name: string; isDemo: boolean }>;
  user: { name: string; role: string };
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [closedGroups, setClosedGroups] = useState<Set<string>>(new Set());
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const storedCollapsed = window.localStorage.getItem(COLLAPSE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- hydratation post-SSR à exécution unique, pas une synchronisation continue.
      if (storedCollapsed === "1") setCollapsed(true);
      const storedGroups = window.localStorage.getItem(GROUPS_KEY);
      if (storedGroups) setClosedGroups(new Set(JSON.parse(storedGroups)));
    } catch {
      // localStorage indisponible — valeurs par défaut.
    }
    setHydrated(true);
  }, []);

  function persistCollapsed(next: boolean) {
    setCollapsed(next);
    try {
      window.localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
    } catch {
      // ignore
    }
  }

  function toggleGroup(label: string) {
    setClosedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      try {
        window.localStorage.setItem(GROUPS_KEY, JSON.stringify([...next]));
      } catch {
        // ignore
      }
      return next;
    });
  }

  const usagePct = planUsage.max ? Math.min(100, Math.round((planUsage.used / planUsage.max) * 100)) : null;
  const initials = user.name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <aside className={`sidebar ${collapsed ? "is-collapsed" : ""}`} style={hydrated ? undefined : { transition: "none" }} aria-label="Navigation principale">
      <div className="sidebar-brand">
        <span className="brand-mark" aria-hidden="true">
          <LogoMark size={18} />
        </span>
        <span className="sidebar-brand-label brand-text">
          <span className="brand-name">ONDEAL</span>
          <span className="brand-sub">Intelligence</span>
        </span>
        <button
          type="button"
          className="sidebar-collapse-btn"
          onClick={() => persistCollapsed(!collapsed)}
          title={collapsed ? "Étendre le menu" : "Réduire le menu"}
          aria-label={collapsed ? "Étendre le menu" : "Réduire le menu"}
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
      </div>

      {!collapsed && (
        <div className="store-card">
          <div className="store-card-body">
            <div className="store-card-name" title={storeName}>
              {storeName}
            </div>
            <div className={`store-card-status is-${storeStatus.tone}`}>
              <span className="status-dot" aria-hidden="true" />
              {storeStatus.label}
            </div>
          </div>
          {stores.length > 1 && <StoreSwitcher currentStoreId={storeId} stores={stores} />}
        </div>
      )}

      {groups.map((group) => {
        const isClosed = closedGroups.has(group.label);
        return (
          <div className="sidebar-group" key={group.label}>
            {!collapsed && (
              <button type="button" className="sidebar-group-toggle" onClick={() => toggleGroup(group.label)} aria-expanded={!isClosed}>
                <span className="sidebar-section-label" style={{ padding: 0 }}>
                  {group.label}
                </span>
                <ChevronDown size={12} className={`sidebar-group-chevron ${!isClosed ? "is-open" : ""}`} />
              </button>
            )}
            <div className={`sidebar-group-items ${!collapsed && isClosed ? "is-closed" : ""}`}>
              {group.items.map((item) => {
                const Icon = NAV_ICONS[item.key] ?? NAV_ICONS[item.href];
                const isActive = active === item.key;
                return (
                  <Link
                    key={item.key}
                    href={item.enabled ? `${item.href}${item.href.includes("?") ? "&" : "?"}store=${storeId}` : "#"}
                    className={`sidebar-link ${isActive ? "active" : ""}`}
                    aria-current={isActive ? "page" : undefined}
                    style={item.enabled ? undefined : { opacity: 0.4, cursor: "not-allowed", pointerEvents: "none" }}
                    title={collapsed ? item.label : item.enabled ? undefined : "Disponible à partir du plan Pro"}
                  >
                    <span>{Icon && <Icon size={15} strokeWidth={2} />}</span>
                    <span className="sidebar-link-label">{item.label}</span>
                    {!collapsed && item.count !== undefined && item.count > 0 && (
                      <span className={`sidebar-count sidebar-count-${item.countTone ?? "neutral"}`} aria-label={`${item.count} éléments`}>
                        {item.count > 999 ? "999+" : item.count}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}

      <div style={{ flex: 1 }} />

      {!collapsed && (
        <div className="plan-card">
          <div className="plan-card-head">
            <span className="plan-card-name">Plan {plan}</span>
            <span className="plan-card-org" title={organizationName}>
              {organizationName}
            </span>
          </div>
          <div className="plan-card-usage">
            <span>Produits synchronisés</span>
            <strong>
              {planUsage.used.toLocaleString("fr-FR")}
              {planUsage.max ? ` / ${planUsage.max.toLocaleString("fr-FR")}` : ""}
            </strong>
          </div>
          {usagePct !== null && (
            <div className="plan-card-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={usagePct} aria-label="Utilisation du plan">
              <div className={`plan-card-bar-fill${usagePct >= 100 ? " is-over" : ""}`} style={{ width: `${usagePct}%` }} />
            </div>
          )}
        </div>
      )}

      <div className="user-card">
        <span className="user-avatar" aria-hidden="true">
          {initials || "—"}
        </span>
        {!collapsed && (
          <span className="user-card-body">
            <span className="user-card-name">{user.name}</span>
            <span className="user-card-role">{user.role}</span>
          </span>
        )}
        <LogoutButton />
      </div>
    </aside>
  );
}
