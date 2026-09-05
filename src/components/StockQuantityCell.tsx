"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * CORRECTIF 05/09/2026 — édition en ligne du stock depuis /stock. Trois
 * temps volontairement distincts (jamais une écriture Shopify au premier
 * clic) : 1) saisie du nouveau nombre, 2) confirmation explicite affichant
 * l'ancien → nouveau, 3) écriture réelle (POST /api/stock/update, qui crée
 * une vraie ActionItem "update_stock" auditée — voir cette route). Réservé
 * aux boutiques Shopify connectées ; sinon le contrôle est désactivé avec
 * une explication plutôt que masqué silencieusement.
 */
export default function StockQuantityCell({
  storeId,
  variantId,
  currentQuantity,
  shopifyConnected,
}: {
  storeId: string;
  variantId: string;
  currentQuantity: number | null;
  shopifyConnected: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"view" | "edit" | "confirm">("view");
  const [value, setValue] = useState(String(currentQuantity ?? 0));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = Number(value);
  const validInput = value.trim() !== "" && Number.isInteger(parsed) && parsed >= 0;

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/stock/update", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ storeId, variantId, newQuantity: parsed, expectedCurrentQuantity: currentQuantity }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok || data.ok === false) {
      setError(data.error ?? data.detail ?? "Échec de la mise à jour du stock.");
      setMode("edit");
      return;
    }
    setMode("view");
    router.refresh();
  }

  if (!shopifyConnected) {
    return (
      <span className="cell-sub" title="Connectez Shopify (Paramètres > Intégrations) pour modifier le stock depuis OnDeal.">
        {currentQuantity ?? <span className="unavailable-note">n/d</span>}
      </span>
    );
  }

  if (mode === "view") {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        {currentQuantity ?? <span className="unavailable-note">n/d</span>}
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          style={{ padding: "1px 6px", fontSize: 11 }}
          onClick={() => {
            setValue(String(currentQuantity ?? 0));
            setError(null);
            setMode("edit");
          }}
        >
          Modifier
        </button>
      </span>
    );
  }

  if (mode === "edit") {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <input
          className="input"
          type="number"
          min={0}
          step={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          style={{ width: 72, padding: "2px 6px" }}
        />
        <button type="button" className="btn btn-primary btn-sm" disabled={!validInput} onClick={() => setMode("confirm")}>
          Enregistrer
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMode("view")}>
          Annuler
        </button>
        {error && <span className="callout callout-error" style={{ fontSize: 11, padding: "2px 6px" }}>{error}</span>}
      </span>
    );
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span style={{ fontSize: 12.5 }}>
        Confirmer {currentQuantity ?? "?"} → <strong>{parsed}</strong> ?
      </span>
      <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={submit}>
        {busy ? "Envoi…" : "Confirmer"}
      </button>
      <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setMode("edit")}>
        Annuler
      </button>
    </span>
  );
}
