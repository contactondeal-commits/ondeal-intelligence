"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Rec = {
  id: string;
  category: string;
  severity: "URGENT" | "OPPORTUNITY" | "SUGGESTION";
  title: string;
  reason: string;
  impact: string;
  confidence: number;
  actionLabel: string | null;
  actionType: string | null;
  product?: { id: string; title: string } | null;
};

const SEVERITY_META: Record<Rec["severity"], { label: string; cls: string; badgeCls: string }> = {
  URGENT: { label: "🔴 Urgent", cls: "urgent", badgeCls: "badge-urgent" },
  OPPORTUNITY: { label: "🟠 Opportunité", cls: "opportunity", badgeCls: "badge-opportunity" },
  SUGGESTION: { label: "🟢 Recommandation", cls: "suggestion", badgeCls: "badge-suggestion" },
};

export default function RecommendationCard({ rec, storeId }: { rec: Rec; storeId: string }) {
  const meta = SEVERITY_META[rec.severity];
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function dismiss() {
    setBusy(true);
    await fetch(`/api/recommendations/${rec.id}/dismiss`, { method: "POST" });
    setBusy(false);
    router.refresh();
  }

  async function prepareAction() {
    if (!rec.actionType) return;
    setBusy(true);
    const res = await fetch("/api/actions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ storeId, recommendationId: rec.id }),
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
    <div className={`rec-card ${meta.cls}`}>
      <div style={{ flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <span className={`badge ${meta.badgeCls}`}>{meta.label}</span>
          <span className="badge badge-neutral">confiance {rec.confidence}%</span>
        </div>
        <div style={{ fontWeight: 700, fontSize: 14.5 }}>{rec.title}</div>
        <div style={{ fontSize: 13.5, color: "#6b6b85", marginTop: 3 }}>
          <strong>Pourquoi ?</strong> {rec.reason}
        </div>
        <div style={{ fontSize: 13.5, color: "#6b6b85", marginTop: 2 }}>
          <strong>Impact potentiel :</strong> {rec.impact}
        </div>
        {message && <div className="unavailable-note" style={{ marginTop: 6 }}>{message}</div>}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 140 }}>
        {rec.actionLabel && rec.actionType && (
          <button className="btn btn-primary" disabled={busy} onClick={prepareAction}>
            {rec.actionLabel}
          </button>
        )}
        <button className="btn btn-secondary" disabled={busy} onClick={dismiss}>
          Ignorer
        </button>
      </div>
    </div>
  );
}
