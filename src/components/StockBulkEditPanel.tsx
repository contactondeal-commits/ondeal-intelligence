"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";

// Doit rester égal à MAX_BULK_ITEMS dans /api/stock/bulk-update/route.ts
// (et ≥ à la plus grande option de taille de page de /stock).
const MAX_BULK = 150;

type Rule = { kind: "absolute"; value: number } | { kind: "delta"; value: number };
type ResultItem = { variantId: string; title: string; newQuantity?: number; reason?: string };
type RunResult = {
  ok: boolean;
  processed: number;
  totalMatching: number;
  nextOffset: number | null;
  applied: ResultItem[];
  skipped: ResultItem[];
  error?: string;
};

export type StockRow = { variantId: string; title: string; storeStock: number | null };

/**
 * Modification de stock EN MASSE (lot 4, 05/09/2026) — toute première
 * demande de la journée : "sélectionner une page de produits, une série
 * ou une catégorie pour appliquer un changement de stock". Deux modes :
 *   - sélection manuelle (cases à cocher dans le tableau /stock, ce
 *     composant) — jusqu'à MAX_BULK variantes, la page /stock permettant de
 *     choisir 50/100/150 lignes (voir Pagination.tsx), donc "toute une page"
 *     tient toujours en un seul lot quel que soit ce choix ;
 *   - "toutes les variantes filtrées" — statut/recherche/catégorie/tri
 *     actuels de la page, traité par lots de MAX_BULK avec "Continuer"
 *     (mêmes conventions que SecureRupturesPanel).
 * Toujours réservé à Shopify (seule plateforme avec écriture stock — voir
 * /api/stock/update) : le message d'erreur du serveur l'explique si besoin.
 */
export default function StockBulkEditPanel({
  storeId,
  selected,
  onClearSelection,
  filteredCount,
  filters,
  shopifyConnected,
}: {
  storeId: string;
  selected: StockRow[];
  onClearSelection: () => void;
  /** Nombre de variantes correspondant aux filtres actuels de la page (mode "Appliquer à tout"). */
  filteredCount: number;
  filters: { status: string; q?: string; category: string; sort: string };
  shopifyConnected: boolean;
}) {
  const router = useRouter();
  const [ruleKind, setRuleKind] = useState<"absolute" | "delta">("absolute");
  const [valueInput, setValueInput] = useState("0");
  const [applyMode, setApplyMode] = useState<"selected" | "filtered">("selected");
  const [stage, setStage] = useState<"idle" | "confirming" | "running" | "done">("idle");
  const [offset, setOffset] = useState(0);
  const [totals, setTotals] = useState({ applied: 0, skipped: 0 });
  const [lastResult, setLastResult] = useState<RunResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function rule(): Rule | null {
    const n = Number(valueInput);
    if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
    if (ruleKind === "absolute" && n < 0) return null;
    return { kind: ruleKind, value: n };
  }

  function open(mode: "selected" | "filtered") {
    setApplyMode(mode);
    setError(null);
    setStage("confirming");
  }

  async function runBatch(currentOffset: number) {
    const r = rule();
    if (!r) {
      setError("Valeur invalide.");
      setStage("confirming");
      return;
    }
    setStage("running");
    setError(null);
    const body =
      applyMode === "selected"
        ? { storeId, rule: r, mode: "selected" as const, items: selected.map((s) => ({ variantId: s.variantId, expectedCurrentQuantity: s.storeStock })) }
        : { storeId, rule: r, mode: "filtered" as const, filters, offset: currentOffset };
    const res = await fetch("/api/stock/bulk-update", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as RunResult;
    if (!res.ok || data.error) {
      setError(data.error ?? "Échec de la modification en masse.");
      setStage("confirming");
      return;
    }
    setLastResult(data);
    setTotals((prev) => ({ applied: prev.applied + data.applied.length, skipped: prev.skipped + data.skipped.length }));
    setOffset(data.nextOffset ?? currentOffset);
    setStage("done");
  }

  function close() {
    setStage("idle");
    setOffset(0);
    setTotals({ applied: 0, skipped: 0 });
    setLastResult(null);
    setError(null);
    if (applyMode === "selected") onClearSelection();
    router.refresh();
  }

  const r = rule();
  const previewValue = r ? (r.kind === "absolute" ? `= ${r.value}` : `${r.value >= 0 ? "+" : ""}${r.value}`) : null;

  return (
    <>
      <div className="card" style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <strong>Modifier le stock en masse</strong>
        <select className="input" style={{ width: "auto" }} value={ruleKind} onChange={(e) => setRuleKind(e.target.value as "absolute" | "delta")}>
          <option value="absolute">Définir une quantité exacte</option>
          <option value="delta">Ajuster de (+/-)</option>
        </select>
        <label className="field" style={{ margin: 0 }}>
          <span className="cell-sub">{ruleKind === "absolute" ? "Nouvelle quantité" : "Ajustement"}</span>
          <input className="input" style={{ width: 100 }} type="number" step="1" min={ruleKind === "absolute" ? 0 : undefined} value={valueInput} onChange={(e) => setValueInput(e.target.value)} />
        </label>
        <Button variant="primary" size="sm" disabled={selected.length === 0 || !shopifyConnected} onClick={() => open("selected")}>
          Appliquer à la sélection ({selected.length}) →
        </Button>
        {selected.length > 0 && (
          <Button variant="secondary" size="sm" onClick={onClearSelection}>
            Annuler la sélection
          </Button>
        )}
        <Button variant="secondary" size="sm" disabled={filteredCount === 0 || !shopifyConnected} onClick={() => open("filtered")}>
          Appliquer à tout le filtre actuel ({filteredCount.toLocaleString("fr-FR")}) →
        </Button>
        {!shopifyConnected && <span className="cell-sub">Nécessite Shopify connecté (Paramètres &gt; Intégrations).</span>}
      </div>

      <Modal open={stage !== "idle"} onClose={() => (stage === "running" ? undefined : close())} wide labelledBy="bulk-stock-title">
        <h2 id="bulk-stock-title" style={{ fontSize: 16, fontWeight: 800, marginBottom: 10 }}>
          Modification de stock en masse
        </h2>

        {stage === "confirming" && (
          <>
            <p className="cell-sub" style={{ marginBottom: 10 }}>
              {applyMode === "selected"
                ? `${selected.length} variante(s) sélectionnée(s) manuellement.`
                : `Toutes les variantes correspondant au filtre actuel (${filteredCount.toLocaleString("fr-FR")} au total), par lots de ${MAX_BULK}.`}
            </p>
            <p className="cell-sub" style={{ marginBottom: 12 }}>
              Règle : {ruleKind === "absolute" ? "définir le stock à" : "ajuster le stock de"}{" "}
              <strong>{previewValue ?? "—"}</strong>
              {ruleKind === "delta" && " (jamais en dessous de 0)"}.
            </p>
            {ruleKind === "delta" && applyMode === "filtered" && (
              <div className="callout callout-warning" style={{ marginBottom: 12 }}>
                Une variante dont le stock actuel n&apos;est pas connu sera ignorée (impossible de calculer un ajustement relatif sans deviner).
              </div>
            )}
            {error && <div className="callout callout-error" style={{ marginBottom: 12 }}>{error}</div>}
            <div style={{ display: "flex", gap: 10 }}>
              <Button variant="secondary" onClick={close}>
                Annuler
              </Button>
              <Button variant="primary" onClick={() => runBatch(0)} disabled={!r}>
                Confirmer {applyMode === "filtered" ? "et traiter le premier lot" : ""} →
              </Button>
            </div>
          </>
        )}

        {stage === "running" && <p className="cell-sub">Modification en cours…</p>}

        {stage === "done" && lastResult && (
          <>
            <p className="cell-sub" style={{ marginBottom: 10 }}>
              Lot traité : {lastResult.processed} variante(s) sur {lastResult.totalMatching.toLocaleString("fr-FR")} au total.
            </p>
            <ul style={{ listStyle: "none", margin: "0 0 12px", padding: 0, display: "flex", flexDirection: "column", gap: 6, fontSize: 13.5 }}>
              <li>✅ {lastResult.applied.length} variante(s) mise(s) à jour sur Shopify.</li>
              {lastResult.skipped.length > 0 && <li className="unavailable-note">⚠️ {lastResult.skipped.length} ignorée(s) — voir détail ci-dessous.</li>}
            </ul>
            {lastResult.skipped.length > 0 && (
              <div className="table-scroll" style={{ maxHeight: 200, marginBottom: 12 }}>
                <table className="table table-compact">
                  <thead>
                    <tr>
                      <th>Variante</th>
                      <th>Raison</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lastResult.skipped.map((s) => (
                      <tr key={s.variantId}>
                        <td>{s.title}</td>
                        <td className="cell-sub">{s.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="cell-sub" style={{ marginBottom: 12 }}>
              Cumul de cette session : {totals.applied} mise(s) à jour, {totals.skipped} ignorée(s). Historique complet dans les{" "}
              <Link href={`/actions?store=${storeId}`} style={{ color: "var(--color-primary-dark)", fontWeight: 700 }}>
                Actions
              </Link>
              .
            </p>
            <div style={{ display: "flex", gap: 10 }}>
              <Button variant="secondary" onClick={close}>
                Fermer
              </Button>
              {lastResult.nextOffset !== null && (
                <Button variant="primary" onClick={() => runBatch(offset)}>
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
