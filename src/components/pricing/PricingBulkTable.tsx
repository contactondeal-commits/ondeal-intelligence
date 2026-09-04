"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import DataTag from "@/components/ui/DataTag";
import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";
import { MARGIN_THRESHOLDS } from "@/lib/intelligence/margin";
import { supplierCostSourceLabel } from "@/lib/intelligence/costs";
import type { PricingRow } from "@/lib/pricing/query";

const MAX_BULK = 50;

const PHASE_LABEL: Record<string, string> = {
  signal: "Signal",
  confirm: "À valider",
  "ready-execute": "Prête",
  "done-success": "Exécutée",
  "done-failed": "Échec",
  stale: "Obsolète",
};
const PHASE_TONE: Record<string, string> = { signal: "neutral", confirm: "warning", "ready-execute": "info", "done-success": "success", "done-failed": "danger", stale: "danger" };

function eur(v: number | null): string {
  return v === null ? "—" : `${v.toFixed(2)} €`;
}
function pct(v: number | null): string {
  return v === null ? "—" : `${(v * 100).toFixed(1)} %`;
}

type Rule = { kind: "factor"; factor: number } | { kind: "target_margin"; targetRate: number };
type PreviewItem = {
  recommendationId: string;
  ok: boolean;
  error?: string;
  actionId?: string;
  title?: string;
  currentPrice?: number | null;
  newPrice?: number | null;
  priceError?: string;
};
type ConfirmResultItem = { actionId: string; confirmOk: boolean; confirmError?: string; executed?: boolean; executeOk?: boolean; detail?: string };

/**
 * Chantier 3 — sélection multiple + action groupée sur Prix & Marge.
 * Composant client autonome : ne touche à rien du Decision Workspace
 * individuel (DecisionCard), qui reste utilisable ligne par ligne comme
 * avant ("Décider"/"Simuler" inchangés). Chaque action groupée passe par
 * /api/actions/bulk (préparation) puis /api/actions/bulk/confirm
 * (confirmation + exécution), qui réutilisent tels quels /api/actions,
 * /api/actions/[id]/confirm et /api/actions/[id]/execute — le moteur de
 * décision (Phase 3) n'est ni modifié ni dupliqué.
 */
export default function PricingBulkTable({ rows, storeId, storeIdParam, marginFilterActive }: { rows: PricingRow[]; storeId: string; storeIdParam: string; marginFilterActive: boolean }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [ruleKind, setRuleKind] = useState<"factor" | "target_margin">("target_margin");
  const [factorInput, setFactorInput] = useState("2.5");
  const [targetInput, setTargetInput] = useState("20");
  const [stage, setStage] = useState<"idle" | "loading" | "reviewing" | "confirming" | "done">("idle");
  const [preview, setPreview] = useState<PreviewItem[]>([]);
  const [results, setResults] = useState<ConfirmResultItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const eligible = rows.filter((r) => r.openRecommendationId);
  const allSelectedOnPage = eligible.length > 0 && eligible.every((r) => selected.has(r.openRecommendationId!));

  function toggleAll() {
    if (!marginFilterActive) return;
    setSelected((prev) => {
      if (allSelectedOnPage) return new Set();
      const next = new Set(prev);
      for (const r of eligible.slice(0, MAX_BULK)) next.add(r.openRecommendationId!);
      return next;
    });
  }
  function toggleOne(recommendationId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(recommendationId)) next.delete(recommendationId);
      else if (next.size < MAX_BULK) next.add(recommendationId);
      return next;
    });
  }

  function rule(): Rule | null {
    if (ruleKind === "factor") {
      const factor = Number(factorInput);
      if (!Number.isFinite(factor) || factor <= 0) return null;
      return { kind: "factor", factor };
    }
    const target = Number(targetInput);
    if (!Number.isFinite(target) || target <= 0 || target >= 100) return null;
    return { kind: "target_margin", targetRate: target / 100 };
  }

  async function openPreview() {
    const r = rule();
    if (!r) {
      setError("Valeur invalide.");
      return;
    }
    setError(null);
    setStage("loading");
    const res = await fetch("/api/actions/bulk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ storeId, recommendationIds: [...selected], rule: r }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? "Échec de la préparation.");
      setStage("idle");
      return;
    }
    setPreview(data.items ?? []);
    setStage("reviewing");
  }

  async function confirmAll() {
    const applicable = preview.filter((i) => i.ok && i.actionId && i.newPrice != null);
    if (applicable.length === 0) return;
    setStage("confirming");
    setError(null);
    const res = await fetch("/api/actions/bulk/confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ storeId, items: applicable.map((i) => ({ actionId: i.actionId, newPrice: i.newPrice })) }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? "Échec de la confirmation.");
      setStage("reviewing");
      return;
    }
    setResults(data.items ?? []);
    setStage("done");
  }

  function close() {
    setStage("idle");
    setPreview([]);
    setResults([]);
    setSelected(new Set());
    router.refresh();
  }

  return (
    <>
      {selected.size > 0 && (
        <div className="card" style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <strong>
            {selected.size} sélectionné{selected.size > 1 ? "s" : ""}
          </strong>
          <select className="input" style={{ width: "auto" }} value={ruleKind} onChange={(e) => setRuleKind(e.target.value as "factor" | "target_margin")}>
            <option value="target_margin">Atteindre une marge cible</option>
            <option value="factor">Appliquer un facteur au prix</option>
          </select>
          {ruleKind === "factor" ? (
            <label className="field" style={{ margin: 0 }}>
              <span className="cell-sub">Facteur (ex. 2.5)</span>
              <input className="input" style={{ width: 90 }} type="number" min="0.01" step="0.01" value={factorInput} onChange={(e) => setFactorInput(e.target.value)} />
            </label>
          ) : (
            <label className="field" style={{ margin: 0 }}>
              <span className="cell-sub">Marge cible (%)</span>
              <input className="input" style={{ width: 90 }} type="number" min="0.1" max="99" step="0.1" value={targetInput} onChange={(e) => setTargetInput(e.target.value)} />
            </label>
          )}
          <Button variant="primary" size="sm" onClick={openPreview}>
            Prévisualiser →
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setSelected(new Set())}>
            Annuler la sélection
          </Button>
        </div>
      )}
      {error && stage === "idle" && (
        <div className="callout callout-error" style={{ marginBottom: 12 }}>
          {error}
        </div>
      )}

      <div className="table-scroll">
        <table className="table table-compact">
          <thead>
            <tr>
              <th style={{ width: 28 }}>
                <input
                  type="checkbox"
                  checked={allSelectedOnPage}
                  onChange={toggleAll}
                  disabled={!marginFilterActive || eligible.length === 0}
                  title={marginFilterActive ? "Tout sélectionner sur cette page" : "Filtrez par marge brute pour activer la sélection groupée"}
                  aria-label="Tout sélectionner sur cette page"
                />
              </th>
              <th>Produit / variante</th>
              <th className="num">
                Prix <DataTag status="real" compact />
              </th>
              <th className="num">Coût</th>
              <th className="num">
                Marge brute <DataTag status="calculated" compact />
              </th>
              <th className="num">Marge complète</th>
              <th>Opportunité</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="unavailable-note" style={{ padding: 24, textAlign: "center" }}>
                  Aucune variante ne correspond à ces critères.
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const a = r.analysis;
              const grossTone = a.grossMarginRate === null ? "" : a.grossMarginRate < 0 ? "is-negative" : a.grossMarginRate < MARGIN_THRESHOLDS.faibleRate ? "is-low" : "";
              return (
                <tr key={r.variantId}>
                  <td>
                    {r.openRecommendationId && (
                      <input
                        type="checkbox"
                        checked={selected.has(r.openRecommendationId)}
                        onChange={() => toggleOne(r.openRecommendationId!)}
                        disabled={!marginFilterActive}
                        aria-label={`Sélectionner ${r.productTitle}`}
                      />
                    )}
                  </td>
                  <td>
                    <div className="cell-title">{r.productTitle}</div>
                    <div className="cell-sub cell-sub-clip" title={r.sku ? `SKU ${r.sku}` : undefined}>
                      {r.variantCount > 1 ? `${r.variantTitle} · ` : ""}
                      stock {r.inventoryQuantity ?? "n/d"}
                      {r.sku ? ` · SKU ${r.sku}` : ""}
                    </div>
                  </td>
                  <td className="num">{eur(a.sellingPrice)}</td>
                  <td className="num" title={supplierCostSourceLabel(a.supplierCostSource)}>
                    {eur(a.supplierCost)} <DataTag status={a.status.supplierCost} compact />
                  </td>
                  <td className={`num ${grossTone}`}>
                    {eur(a.grossMargin)} <span className="cell-sub">({pct(a.grossMarginRate)})</span>
                  </td>
                  <td className="num">
                    {a.margin !== null ? (
                      <span className={a.margin < 0 ? "is-negative" : ""} title={`Hypothèses : transport ${eur(a.shippingCost)}, frais ${pct(a.paymentFees !== null && a.sellingPrice ? a.paymentFees / a.sellingPrice : null)}`}>
                        {eur(a.margin)} <span className="cell-sub">({pct(a.marginRate)})</span> <DataTag status="estimated" compact />
                      </span>
                    ) : (
                      <span className="cell-sub" title={a.supplierCost === null ? "Coût fournisseur manquant" : "Transport et/ou frais de paiement non renseignés"}>
                        <DataTag status="unavailable" compact />
                      </span>
                    )}
                  </td>
                  <td>
                    {r.signal ? (
                      <div className="signal-cell">
                        <span className={`badge ${r.signal.severity === "URGENT" ? "badge-urgent" : r.signal.severity === "OPPORTUNITY" ? "badge-opportunity" : "badge-suggestion"}`}>{r.signal.label}</span>
                        {r.phase && <span className={`phase-pill phase-pill-${PHASE_TONE[r.phase]}`}>{PHASE_LABEL[r.phase]}</span>}
                      </div>
                    ) : (
                      <span className="cell-sub">Aucun signal</span>
                    )}
                  </td>
                  <td>
                    <Link className={`btn btn-sm ${r.openRecommendationId ? "btn-primary" : "btn-secondary"}`} href={`/pricing/${r.variantId}?store=${storeIdParam}`}>
                      {r.openRecommendationId ? (r.phase && r.phase !== "signal" ? "Reprendre" : "Décider") : "Simuler"}
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Modal open={stage !== "idle"} onClose={() => (stage === "confirming" ? undefined : close())} wide labelledBy="bulk-modal-title">
        <h2 id="bulk-modal-title" style={{ fontSize: 16, fontWeight: 800, marginBottom: 10 }}>
          Action groupée
        </h2>

        {stage === "loading" && <p className="cell-sub">Préparation des {selected.size} actions…</p>}

        {(stage === "reviewing" || stage === "confirming") && (
          <>
            <p className="cell-sub" style={{ marginBottom: 10 }}>
              {preview.filter((i) => i.ok && i.newPrice != null).length} produit(s) sur {preview.length} prêt(s) à être repricé(s). Ces modifications seront appliquées dans Shopify après confirmation.
            </p>
            {error && <div className="callout callout-error" style={{ marginBottom: 10 }}>{error}</div>}
            <div className="table-scroll" style={{ maxHeight: 320 }}>
              <table className="table table-compact">
                <thead>
                  <tr>
                    <th>Produit</th>
                    <th className="num">Prix actuel</th>
                    <th className="num">Nouveau prix</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((i) => (
                    <tr key={i.recommendationId}>
                      <td>{i.title ?? i.recommendationId}</td>
                      <td className="num">{i.currentPrice != null ? eur(i.currentPrice) : "—"}</td>
                      <td className="num">
                        {i.newPrice != null ? (
                          eur(i.newPrice)
                        ) : (
                          <span className="cell-sub" title={i.priceError ?? i.error}>
                            <DataTag status="unavailable" compact /> exclu
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="callout callout-warning" style={{ marginTop: 12, marginBottom: 12 }}>
              Ces modifications seront appliquées dans Shopify après confirmation.
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <Button variant="secondary" onClick={close} disabled={stage === "confirming"}>
                Annuler
              </Button>
              <Button variant="primary" onClick={confirmAll} disabled={stage === "confirming" || preview.filter((i) => i.newPrice != null).length === 0}>
                {stage === "confirming" ? "Confirmation en cours…" : `Confirmer les ${preview.filter((i) => i.newPrice != null).length} →`}
              </Button>
            </div>
          </>
        )}

        {stage === "done" && (
          <>
            <p className="cell-sub" style={{ marginBottom: 10 }}>
              {results.filter((r) => r.executeOk).length} exécutée(s) avec succès, {results.filter((r) => !r.executeOk).length} échec(s). Chaque action reste consultable dans l&apos;
              <Link href={`/actions?store=${storeIdParam}`} style={{ color: "var(--color-primary-dark)", fontWeight: 700 }}>
                historique des Actions
              </Link>
              .
            </p>
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6, maxHeight: 280, overflowY: "auto" }}>
              {results.map((r) => (
                <li key={r.actionId} className="cell-sub">
                  <DataTag status={r.executeOk ? "real" : "unavailable"} compact /> {r.detail ?? r.confirmError ?? (r.executeOk ? "Exécutée" : "Échec")}
                </li>
              ))}
            </ul>
            <div style={{ marginTop: 14 }}>
              <Button variant="primary" onClick={close}>
                Fermer
              </Button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
