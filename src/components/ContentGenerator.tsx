"use client";

import { useState } from "react";

const FORMATS = [
  { key: "accroche", label: "Accroche" },
  { key: "post_court", label: "Post court" },
  { key: "description", label: "Description" },
  { key: "script_video", label: "Script vidéo" },
];

export default function ContentGenerator({ products, storeId }: { products: Array<{ id: string; title: string }>; storeId: string }) {
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const [format, setFormat] = useState("post_court");
  const [result, setResult] = useState<{ text: string; missingData: string[] } | null>(null);
  const [busy, setBusy] = useState(false);

  async function generate() {
    setBusy(true);
    const res = await fetch("/api/marketing/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ storeId, productId, format }),
    });
    const data = await res.json().catch(() => null);
    setBusy(false);
    if (data?.ok) setResult(data.result);
  }

  if (products.length === 0) return <p className="unavailable-note">Aucun produit synchronisé.</p>;

  return (
    <div>
      <div className="grid grid-3" style={{ marginBottom: 12 }}>
        <div className="field">
          <label>Produit</label>
          <select className="input" value={productId} onChange={(e) => setProductId(e.target.value)}>
            {products.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Format</label>
          <select className="input" value={format} onChange={(e) => setFormat(e.target.value)}>
            {FORMATS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
        </div>
        <div className="field" style={{ justifyContent: "flex-end" }}>
          <button className="btn btn-primary" disabled={busy} onClick={generate}>{busy ? "…" : "Générer"}</button>
        </div>
      </div>

      {result && (
        <div className="card" style={{ background: "var(--color-neutral-soft)" }}>
          <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 14, margin: 0 }}>{result.text}</pre>
          {result.missingData.length > 0 && (
            <p className="unavailable-note" style={{ marginTop: 8 }}>
              Données non disponibles omises du texte : {result.missingData.join(", ")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
