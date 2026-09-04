"use client";

import Link from "next/link";
import { useState } from "react";
import StoreSwitcher from "@/components/StoreSwitcher";
import LogoutButton from "@/components/LogoutButton";

export interface NavItem {
  href: string;
  label: string;
  icon: string;
  feature?: string;
}
export interface NavGroup {
  label: string;
  items: NavItem[];
}

export default function Sidebar({
  groups,
  active,
  storeId,
  storeName,
  plan,
  organizationName,
  stores,
  enabledFeatures,
}: {
  groups: NavGroup[];
  active: string;
  storeId: string;
  storeName: string;
  plan: string;
  organizationName: string;
  stores: Array<{ id: string; name: string; isDemo: boolean }>;
  enabledFeatures: string[];
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [closedGroups, setClosedGroups] = useState<Set<string>>(new Set());

  function toggleGroup(label: string) {
    setClosedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  return (
    <aside className={`sidebar ${collapsed ? "is-collapsed" : ""}`}>
      <div className="sidebar-brand">
        <span>🟣</span>
        <span className="sidebar-brand-label" style={{ flex: 1 }}>
          OnDeal Intelligence
        </span>
        <button
          type="button"
          className="sidebar-collapse-btn"
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? "Étendre le menu" : "Réduire le menu"}
          aria-label={collapsed ? "Étendre le menu" : "Réduire le menu"}
        >
          {collapsed ? "»" : "«"}
        </button>
      </div>

      {!collapsed && <StoreSwitcher currentStoreId={storeId} stores={stores} />}

      {groups.map((group) => {
        const isClosed = closedGroups.has(group.label);
        return (
          <div className="sidebar-group" key={group.label}>
            {!collapsed && (
              <button type="button" className="sidebar-group-toggle" onClick={() => toggleGroup(group.label)}>
                <span className="sidebar-section-label" style={{ padding: 0 }}>
                  {group.label}
                </span>
                <span className={`sidebar-group-chevron ${!isClosed ? "is-open" : ""}`}>▶</span>
              </button>
            )}
            <div className={`sidebar-group-items ${!collapsed && isClosed ? "is-closed" : ""}`}>
              {group.items.map((item) => {
                const enabled = !item.feature || enabledFeatures.includes(item.href);
                return (
                  <Link
                    key={item.href}
                    href={enabled ? `${item.href}?store=${storeId}` : "#"}
                    className={`sidebar-link ${active === item.href ? "active" : ""}`}
                    style={enabled ? undefined : { opacity: 0.4, cursor: "not-allowed", pointerEvents: "none" }}
                    title={collapsed ? item.label : enabled ? undefined : "Disponible à partir du plan Pro"}
                  >
                    <span>{item.icon}</span>
                    <span className="sidebar-link-label">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}

      <div style={{ flex: 1 }} />
      <div className="sidebar-footer">
        <div className="sidebar-footer-text">
          Plan {plan} — {organizationName}
        </div>
      </div>
      <LogoutButton />
    </aside>
  );
}
