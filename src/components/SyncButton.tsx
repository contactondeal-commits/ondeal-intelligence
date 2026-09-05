"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { RefreshCw } from "lucide-react";
import Button from "@/components/ui/Button";

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
    // CORRECTIF 05/09/2026 — try/catch/finally ajouté : sur un gros
    // catalogue, une requête peut échouer au niveau réseau (timeout serveur,
    // connexion coupée) plutôt que de renvoyer une réponse HTTP propre. Sans
    // ce filet, `fetch` levait une exception non interceptée et le bouton
    // restait bloqué sur "Synchronisation…" indéfiniment (jamais remis à
    // `loading: false`) — perçu par l'utilisateur comme le bouton qui
    // "disparaît"/se fige. Voir /api/sync/route.ts (maxDuration ajouté au
    // même correctif) pour la cause côté serveur.
    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ storeId }),
      });
      const data = await res.json().catch(() => ({}));
      setResult(res.ok ? "Synchronisation terminée." : data.error ?? "Échec de synchronisation.");
    } catch {
      setResult("Échec de synchronisation (connexion interrompue) — réessayez dans quelques instants.");
    } finally {
      setLoading(false);
      router.refresh();
    }
  }

  const disabled = !shopifyConnected && !judgemeConnected;

  return (
    <div style={{ textAlign: "right" }}>
      <Button
        variant="primary"
        size="sm"
        icon={<RefreshCw size={14} className={loading ? "spin" : undefined} />}
        onClick={runSync}
        loading={loading}
        disabled={disabled}
        title={disabled ? "Connectez au moins une intégration" : undefined}
      >
        {loading ? "Synchronisation…" : "Synchroniser"}
      </Button>
      {result && <div className="unavailable-note" style={{ marginTop: 6 }}>{result}</div>}
    </div>
  );
}
