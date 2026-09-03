"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function CostAssumptionForm({ storeId, productId }: { storeId: string; productId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [supplierCost, setSupplierCost] = useState("");
  const [shippingCost, setShippingCost] = useState("");
  const [paymentFeesRate, setPaymentFeesRate] = useState("2.9");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    await fetch("/api/cost-assumptions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        storeId,
        productId,
        supplierCost: supplierCost ? Number(supplierCost) : null,
        shippingCost: shippingCost ? Number(shippingCost) : null,
        paymentFeesRate: paymentFeesRate ? Number(paymentFeesRate) / 100 : null,
      }),
    });
    setBusy(false);
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return <button className="btn btn-secondary" onClick={() => setOpen(true)} style={{ padding: "5px 10px", fontSize: 12 }}>Coûts</button>;
  }

  return (
    <div style={{ position: "relative" }}>
      <div className="card" style={{ position: "absolute", right: 0, top: 0, zIndex: 10, width: 220, padding: 14 }}>
        <div className="field"><label>Coût fournisseur (€)</label><input className="input" value={supplierCost} onChange={(e) => setSupplierCost(e.target.value)} /></div>
        <div className="field"><label>Transport (€)</label><input className="input" value={shippingCost} onChange={(e) => setShippingCost(e.target.value)} /></div>
        <div className="field"><label>Frais paiement (%)</label><input className="input" value={paymentFeesRate} onChange={(e) => setPaymentFeesRate(e.target.value)} /></div>
        <div style={{ display: "flex", gap: 6 }}>
          <button className="btn btn-primary" disabled={busy} onClick={save} style={{ flex: 1 }}>Enregistrer</button>
          <button className="btn btn-secondary" disabled={busy} onClick={() => setOpen(false)}>×</button>
        </div>
      </div>
    </div>
  );
}
