"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Status = "active" | "draft" | "archived";
type Target = "ACTIVE" | "DRAFT" | "ARCHIVED";

const TARGET_LABEL: Record<Target, string> = {
  ACTIVE: "Republier",
  DRAFT: "Mettre en brouillon",
  ARCHIVED: "Archiver",
};

/**
 * CORRECTIF 05/09/2026 v4 — "Archiver / Mettre en brouillon / Republier"
 * directement depuis la fiche produit. Même principe à trois temps que
 * StockQuantityCell (jamais une écriture Shopify au premier clic) : 1) choix
 * du statut cible, 2) confirmation explicite affichant l'ancien → nouveau
 * (l'archivage/dépublication retire le produit de la vente — jamais un
 * effet silencieux), 3) écriture réelle (POST /api/products/[id]/status, qui
 * crée une vraie ActionItem "set_product_status" auditée). Réservé aux
 * boutiques Shopify connectées ; sinon expliqué plutôt que masqué.
 */
export default function ProductStatusActions({
  storeId,
  productId,
  currentStatus,
  shopifyConnected,
}: {
  storeId: string;
  productId: string;
  currentStatus: Status;
  shopifyConnected: boolean;
}) {
  const router = useRouter();
  const [pendingTarget, setPendingTarget] = useState<Target | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (!shopifyConnected) {
    return (
      <p className="cell-sub" title="Connectez Shopify (Paramètres > Intégrations) pour archiver, mettre en brouillon ou republier ce produit depuis OnDeal.">
        Archiver / republier ce produit nécessite Shopify connecté.
      </p>
    );
  }


  const availableTargets: Target[] = (["ACTIVE", "DRAFT", "ARCHIVED"] as Target[]).filter((t) => t.toLowerCase() !== currentStatus);

  async function submit(target: Target) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/products/${productId}/status`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ storeId, targetStatus: target, expectedCurrentStatus: currentStatus }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok || data.ok === false) {
      setError(data.error ?? data.detail ?? "Échec du changement de statut.");
      setPendingTarget(null);
      return;
    }
    setDone(data.detail ?? "Statut mis à jour.");
    setPendingTarget(null);
    router.refresh();
  }

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      {pendingTarget === null &&
        availableTargets.map((t) => (
          <button key={t} type="button" className="btn btn-secondary btn-sm" onClick={() => { setError(null); setDone(null); setPendingTarget(t); }}>
            {TARGET_LABEL[t]}
          </button>
        ))}
      {pendingTarget !== null && (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 12.5 }}>
            Confirmer « {currentStatus} » → <strong>{TARGET_LABEL[pendingTarget].toLowerCase()}</strong> sur Shopify ?
            {pendingTarget === "ARCHIVED" && " Le produit sera retiré de la vente."}
          </span>
          <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => submit(pendingTarget)}>
            {busy ? "Envoi…" : "Confirmer"}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setPendingTarget(null)}>
            Annuler
          </button>
        </span>
      )}
      {error && <span className="callout callout-error" style={{ fontSize: 11, padding: "2px 6px" }}>{error}</span>}
      {done && <span className="cell-sub" style={{ fontSize: 11.5 }}>{done}</span>}
    </div>
  );
}
