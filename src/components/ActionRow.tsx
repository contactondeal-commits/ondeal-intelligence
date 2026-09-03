"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Action = {
  id: string;
  type: string;
  sensitivity: "SENSITIVE" | "SAFE";
  status: "PENDING_VALIDATION" | "CONFIRMED";
  payload: Record<string, unknown>;
  title: string;
  reason: string;
  productTitle: string | null;
};

const NEEDS_PRICE_INPUT = new Set(["update_price"]);

export default function ActionRow({ action }: { action: Action }) {
  const router = useRouter();
  const [newPrice, setNewPrice] = useState(
    typeof action.payload.currentPrice === "number" ? String(action.payload.currentPrice) : "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const requiresPrice = NEEDS_PRICE_INPUT.has(action.type) && action.status === "PENDING_VALIDATION";

  async function confirm() {
    setBusy(true);
    setError(null);
    const params = requiresPrice ? { newPrice: Number(newPrice) } : {};
    if (requiresPrice && (!newPrice || Number(newPrice) <= 0)) {
      setError("Indiquez un nouveau prix valide avant de confirmer.");
      setBusy(false);
      return;
    }
    const res = await fetch(`/api/actions/${action.id}/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ params }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Échec de confirmation.");
      return;
    }
    setConfirming(false);
    router.refresh();
  }

  async function execute() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/actions/${action.id}/execute`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok || !data.ok) {
      setError(data.error ?? data.detail ?? "Échec d'exécution.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="rec-card" style={{ borderLeft: `4px solid ${action.sensitivity === "SENSITIVE" ? "#dc2626" : "#16a34a"}` }}>
      <div style={{ flex: 1 }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 4 }}>
          <span className={`badge ${action.sensitivity === "SENSITIVE" ? "badge-urgent" : "badge-suggestion"}`}>
            {action.sensitivity === "SENSITIVE" ? "Action sensible" : "Action informationnelle"}
          </span>
          <span className="badge badge-neutral">{action.status}</span>
        </div>
        <div style={{ fontWeight: 700 }}>{action.title}</div>
        {action.productTitle && <div style={{ fontSize: 13, color: "#6b6b85" }}>Produit : {action.productTitle}</div>}
        <div style={{ fontSize: 13, color: "#6b6b85", marginTop: 3 }}>{action.reason}</div>

        {error && <div className="callout callout-error" style={{ marginTop: 8, marginBottom: 0 }}>{error}</div>}

        {requiresPrice && confirming && (
          <div className="field" style={{ marginTop: 10, maxWidth: 200 }}>
            <label>Nouveau prix (€)</label>
            <input className="input" type="number" step="0.01" value={newPrice} onChange={(e) => setNewPrice(e.target.value)} />
          </div>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 160 }}>
        {action.status === "PENDING_VALIDATION" && action.sensitivity === "SAFE" && (
          <button className="btn btn-primary" disabled={busy} onClick={execute}>
            {busy ? "…" : "Marquer comme prise en charge"}
          </button>
        )}
        {action.status === "PENDING_VALIDATION" && action.sensitivity === "SENSITIVE" && !confirming && (
          <button className="btn btn-primary" disabled={busy} onClick={() => setConfirming(true)}>
            Voir & confirmer
          </button>
        )}
        {action.status === "PENDING_VALIDATION" && action.sensitivity === "SENSITIVE" && confirming && (
          <>
            <div className="callout callout-warning" style={{ margin: 0, padding: 10, fontSize: 12.5 }}>
              Cette action va modifier votre boutique.
            </div>
            <button className="btn btn-primary" disabled={busy} onClick={confirm}>
              Confirmer
            </button>
            <button className="btn btn-secondary" disabled={busy} onClick={() => setConfirming(false)}>
              Annuler
            </button>
          </>
        )}
        {action.status === "CONFIRMED" && (
          <button className="btn btn-primary" disabled={busy} onClick={execute}>
            {busy ? "Exécution…" : "Exécuter maintenant"}
          </button>
        )}
      </div>
    </div>
  );
}
