"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Button from "@/components/ui/Button";

/**
 * Hypothèses boutique (ESTIMÉES, jamais des données Shopify) : transport
 * moyen par unité vendue et taux de frais de paiement. Renseignées une fois
 * pour toute la boutique, elles rendent la marge complète calculable sur
 * tout le catalogue à partir du coût réel Shopify. Une hypothèse produit
 * (Prix & Marge › produit) les remplace au cas par cas.
 */
export default function StoreCostDefaultsForm({
  storeId,
  defaultShippingCost,
  defaultPaymentFeesRate,
}: {
  storeId: string;
  defaultShippingCost: number | null;
  defaultPaymentFeesRate: number | null;
}) {
  const router = useRouter();
  const [shipping, setShipping] = useState(defaultShippingCost !== null ? String(defaultShippingCost) : "");
  const [fees, setFees] = useState(defaultPaymentFeesRate !== null ? String(Math.round(defaultPaymentFeesRate * 10000) / 100) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    const res = await fetch("/api/stores/cost-defaults", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        storeId,
        defaultShippingCost: shipping.trim() === "" ? null : Number(shipping),
        defaultPaymentFeesRate: fees.trim() === "" ? null : Number(fees) / 100,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Échec de l'enregistrement.");
      return;
    }
    setSaved(true);
    router.refresh();
  }

  return (
    <form className="assumptions-form" onSubmit={save}>
      <div className="assumptions-form-head">
        <span className="data-tag data-tag-estimated">Estimé</span>
        <strong>Hypothèses boutique</strong>
        <span className="assumptions-form-hint">Appliquées à toute variante sans hypothèse produit. Jamais confondues avec les données Shopify.</span>
      </div>
      <div className="assumptions-form-fields">
        <label className="field">
          <span>Transport par unité vendue (€)</span>
          <input className="input" type="number" min="0" step="0.01" value={shipping} onChange={(e) => setShipping(e.target.value)} placeholder="non renseigné" />
        </label>
        <label className="field">
          <span>Frais de paiement (%)</span>
          <input className="input" type="number" min="0" max="100" step="0.01" value={fees} onChange={(e) => setFees(e.target.value)} placeholder="non renseigné" />
        </label>
        <Button type="submit" variant="secondary" size="sm" disabled={busy}>
          {busy ? "Enregistrement…" : "Enregistrer et recalculer"}
        </Button>
      </div>
      {error && <div className="callout callout-error" style={{ marginTop: 8 }}>{error}</div>}
      {saved && <div className="assumptions-form-saved">Hypothèses enregistrées — analyse recalculée sur tout le catalogue.</div>}
    </form>
  );
}
