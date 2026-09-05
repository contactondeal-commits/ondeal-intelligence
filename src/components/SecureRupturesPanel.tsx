"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";

type BatchResult = {
  ok: boolean;
  processed: number;
  totalMatching: number;
  nextOffset: number | null;
  cjConnected: boolean | null;
  corrected: Array<{ variantId: string; title: string; newQuantity: number }>;
  stillUnavailable: Array<{ variantId: string; title: string }>;
  unpublished: Array<{ productId: string; title: string }>;
  unpublishFailed: Array<{ productId: string; title: string; error: string }>;
  skippedNoSku: number;
  message?: string;
  error?: string;
};

/**
 * « Sécuriser mes ruptures » (05/09/2026 v3) — version en masse de "Vérifier
 * le fournisseur". Objectif explicite de l'utilisateur : ne jamais rester
 * visiblement en rupture si un réassort est réellement impossible. Un clic
 * traite un lot (voir /api/stock/secure-ruptures) ; "Continuer" relance sur
 * le lot suivant jusqu'à épuisement des ruptures.
 */
export default function SecureRupturesPanel({ storeId, ruptureCount, cjConnected, shopifyConnected }: { storeId: string; ruptureCount: number; cjConnected: boolean; shopifyConnected: boolean }) {
  const router = useRouter();
  const [stage, setStage] = useState<"idle" | "confirming" | "running" | "done">("idle");
  const [offset, setOffset] = useState(0);
  const [totals, setTotals] = useState({ corrected: 0, unpublished: 0, unavailable: 0 });
  const [lastResult, setLastResult] = useState<BatchResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runBatch(currentOffset: number) {
    setStage("running");
    setError(null);
    const res = await fetch("/api/stock/secure-ruptures", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ storeId, offset: currentOffset }),
    });
    const data = (await res.json().catch(() => ({}))) as BatchResult;
    if (!res.ok) {
      setError(data.error ?? "Échec de la sécurisation des ruptures.");
      setStage("confirming");
      return;
    }
    setLastResult(data);
    setTotals((prev) => ({
      corrected: prev.corrected + data.corrected.length,
      unpublished: prev.unpublished + data.unpublished.length,
      unavailable: prev.unavailable + data.stillUnavailable.length,
    }));
    setOffset(data.nextOffset ?? currentOffset);
    setStage("done");
  }

  function close() {
    setStage("idle");
    setOffset(0);
    setTotals({ corrected: 0, unpublished: 0, unavailable: 0 });
    setLastResult(null);
    setError(null);
    router.refresh();
  }

  if (ruptureCount === 0) return null;

  return (
    <>
      <Button
        variant="danger"
        onClick={() => setStage("confirming")}
        disabled={!shopifyConnected}
        title={!shopifyConnected ? "Nécessite Shopify connecté (Paramètres > Intégrations)." : undefined}
        style={{ marginBottom: 12 }}
      >
        Sécuriser mes ruptures ({ruptureCount.toLocaleString("fr-FR")})
      </Button>

      <Modal open={stage !== "idle"} onClose={() => (stage === "running" ? undefined : close())} wide labelledBy="secure-ruptures-title">
        <h2 id="secure-ruptures-title" style={{ fontSize: 16, fontWeight: 800, marginBottom: 10 }}>
          Sécuriser mes ruptures
        </h2>

        {stage === "confirming" && (
          <>
            <p className="cell-sub" style={{ marginBottom: 10 }}>
              Cette action traite vos ruptures de stock ({ruptureCount.toLocaleString("fr-FR")} au total) par lots de 20, en un clic par lot :
            </p>
            <ol style={{ margin: "0 0 12px", paddingLeft: 18, fontSize: 13.5, lineHeight: 1.6 }}>
              <li>Vérifie chaque variante en rupture auprès de CJdropshipping et corrige réellement le stock Shopify si le fournisseur en a.</li>
              <li>
                Dépublie immédiatement (statut Draft sur Shopify) tout produit actif dont <strong>toutes</strong> les variantes sont confirmées à 0 unité — boutique <strong>et</strong>{" "}
                fournisseur — pour ne jamais laisser un produit invendable visible sur votre boutique. Réversible en republiant depuis Shopify.
              </li>
            </ol>
            {!cjConnected && (
              <div className="callout callout-warning" style={{ marginBottom: 12 }}>
                CJdropshipping n&apos;est pas connecté : seule la vérification sera tentée (sans effet), aucune dépublication n&apos;aura lieu — connectez CJdropshipping (Paramètres &gt; Intégrations)
                pour activer la correction et la dépublication automatiques.
              </div>
            )}
            {error && <div className="callout callout-error" style={{ marginBottom: 12 }}>{error}</div>}
            <div style={{ display: "flex", gap: 10 }}>
              <Button variant="secondary" onClick={close}>
                Annuler
              </Button>
              <Button variant="danger" onClick={() => runBatch(0)}>
                Confirmer et traiter le premier lot →
              </Button>
            </div>
          </>
        )}

        {stage === "running" && <p className="cell-sub">Vérification en cours auprès du fournisseur… (peut prendre jusqu&apos;à une minute)</p>}

        {stage === "done" && lastResult && (
          <>
            <p className="cell-sub" style={{ marginBottom: 10 }}>
              Lot traité : {lastResult.processed} variante(s) sur {lastResult.totalMatching.toLocaleString("fr-FR")} rupture(s) au total.
              {lastResult.skippedNoSku > 0 ? ` ${lastResult.skippedNoSku} sans SKU n'ont pas pu être vérifiée(s).` : ""}
            </p>
            {!lastResult.cjConnected && (
              <div className="callout callout-warning" style={{ marginBottom: 12 }}>
                CJdropshipping non connecté — aucune correction ni dépublication n&apos;a eu lieu pour ce lot.
              </div>
            )}
            <ul style={{ listStyle: "none", margin: "0 0 12px", padding: 0, display: "flex", flexDirection: "column", gap: 6, fontSize: 13.5 }}>
              <li>✅ {lastResult.corrected.length} variante(s) réapprovisionnée(s) sur Shopify (stock confirmé chez le fournisseur).</li>
              <li>🔴 {lastResult.unpublished.length} produit(s) dépublié(s) — confirmés sans aucun stock, boutique et fournisseur.</li>
              {lastResult.unpublishFailed.length > 0 && <li className="unavailable-note">⚠️ {lastResult.unpublishFailed.length} dépublication(s) ont échoué — voir l&apos;historique des Actions.</li>}
              <li className="cell-sub">{lastResult.stillUnavailable.length} variante(s) confirmée(s) en rupture réelle chez le fournisseur (rien à corriger).</li>
            </ul>
            <p className="cell-sub" style={{ marginBottom: 12 }}>
              Cumul de cette session : {totals.corrected} corrigée(s), {totals.unpublished} dépubliée(s), {totals.unavailable} rupture(s) réelle(s) confirmée(s).
            </p>
            <div style={{ display: "flex", gap: 10 }}>
              <Button variant="secondary" onClick={close}>
                Fermer
              </Button>
              {lastResult.nextOffset !== null && (
                <Button variant="danger" onClick={() => runBatch(offset)}>
                  Continuer ({(lastResult.totalMatching - offset).toLocaleString("fr-FR")} restant(s)) →
                </Button>
              )}
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
