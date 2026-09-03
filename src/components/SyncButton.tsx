"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function SyncButton({
  storeId,
  shopifyConnected,
  judgemeConnected,
}: {
  storeId: string;
  shopifyConnected: boolean;
  judgemeConnected: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function runSync() {
    setLoading(true);
    setResult(null);
    const res = await fetch("/api/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ storeId }),
    });
    const data = await res.json().catch(() => ({}));
    setLoading(false);
    setResult(res.ok ? "Synchronisation terminée." : data.error ?? "Échec de synchronisation.");
    router.refresh();
  }

  const disabled = !shopifyConnected && !judgemeConnected;

  return (
    <div style={{ textAlign: "right" }}>
      <button className="btn btn-primary" onClick={runSync} disabled={loading || disabled} title={disabled ? "Connectez au moins une intégration" : undefined}>
        {loading ? "Synchronisation…" : "🔄 Synchroniser maintenant"}
      </button>
      {result && <div className="unavailable-note" style={{ marginTop: 6 }}>{result}</div>}
    </div>
  );
}
