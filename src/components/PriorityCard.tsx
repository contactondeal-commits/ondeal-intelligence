"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { RecommendationGroup } from "@/lib/intelligence/group";

const SEVERITY_META: Record<string, { label: string; cls: string; icon: string }> = {
  URGENT: { label: "Urgent", cls: "urgent", icon: "🔴" },
  OPPORTUNITY: { label: "Opportunité", cls: "opportunity", icon: "🟠" },
  SUGGESTION: { label: "Recommandation", cls: "suggestion", icon: "🟢" },
};

/**
 * Carte de priorité "groupée" — affiche un RecommendationGroup produit par
 * group.ts. Quand le groupe ne contient qu'un seul item, agit comme une
 * simple carte de recommandation (dismiss / action). Quand il en contient
 * plusieurs, propose de tout traiter en un clic — chaque action réelle
 * (dismiss/prepare) est envoyée individuellement pour chaque item du
 * groupe, rien n'est simulé.
 */
export default function PriorityCard({ group, storeId }: { group: RecommendationGroup; storeId: string }) {
  const meta = SEVERITY_META[group.severity] ?? SEVERITY_META.SUGGESTION!;
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const { representative, items } = group;

  async function dismissAll() {
    setBusy(true);
    await Promise.all(items.map((r) => fetch(`/api/recommendations/${r.id}/dismiss`, { method: "POST" })));
    setBusy(false);
    router.refresh();
  }

  async function prepareAction() {
    if (!representative.actionType) return;
    setBusy(true);
    const res = await fetch("/api/actions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ storeId, recommendationId: representative.id }),
    });
    setBusy(false);
    if (res.ok) {
      setMessage("Action préparée — rendez-vous dans « Actions » pour la valider.");
      router.refresh();
    } else {
      setMessage("Échec de préparation de l'action.");
    }
  }

  return (
    <div className={`priority-card ${meta.cls}`}>
      <div className="priority-card-icon">{meta.icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
          <span className={`badge badge-${meta.cls}`}>{meta.label}</span>
          <span className="badge badge-neutral">confiance {group.confidence}%</span>
          {items.length > 1 && <span className="priority-card-group-count">{items.length} recommandations groupées</span>}
        </div>
        <div style={{ fontWeight: 700, fontSize: 14.5 }}>{group.title}</div>
        <div style={{ fontSize: 13.5, color: "var(--color-text-muted)", marginTop: 3 }}>
          <strong>Pourquoi ?</strong> {representative.reason}
          {items.length > 1 ? ` (exemple sur ${items.length} au total)` : ""}
        </div>
        <div style={{ fontSize: 13.5, color: "var(--color-text-muted)", marginTop: 2 }}>
          <strong>Impact potentiel :</strong> {representative.impact}
        </div>
        {message && <div className="unavailable-note" style={{ marginTop: 6 }}>{message}</div>}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 150 }}>
        {items.length === 1 && representative.actionLabel && representative.actionType && (
          <button className="btn btn-primary" disabled={busy} onClick={prepareAction}>
            {representative.actionLabel}
          </button>
        )}
        <button className="btn btn-secondary" disabled={busy} onClick={dismissAll}>
          {items.length > 1 ? `Ignorer les ${items.length}` : "Ignorer"}
        </button>
      </div>
    </div>
  );
}
