"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { RecommendationGroup } from "@/lib/intelligence/group";
import type { ActionStatus } from "@prisma/client";
import { SEVERITY_META } from "@/components/ui/severity";
import { isSensitiveActionType } from "@/lib/intelligence/actionTypes";
import { actionKindFor } from "@/lib/intelligence/actionKind";
import { derivePhaseFromExistingAction, type DecisionPhase } from "@/lib/intelligence/decision";
import { simulatePriceChange, simulateRestock } from "@/lib/intelligence/simulate";
import { isPricePrediction, type PricePrediction } from "@/lib/intelligence/prediction";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import DataTag from "@/components/ui/DataTag";
import ActionKindBadge from "@/components/decision/ActionKindBadge";
import EvidencePanel, { type DataPoint } from "@/components/decision/EvidencePanel";
import SimulationPanel from "@/components/decision/SimulationPanel";
import ResultPanel, { type DisplayResult } from "@/components/decision/ResultPanel";
import DecisionStepper from "@/components/decision/DecisionStepper";

/** Libellé et ton de l'état RÉEL de la décision (DecisionPhase) — jamais un état d'affichage inventé. */
const PHASE_META: Record<DecisionPhase, { label: string; tone: "neutral" | "warning" | "info" | "success" | "danger" }> = {
  signal: { label: "Signal ouvert", tone: "neutral" },
  confirm: { label: "À valider", tone: "warning" },
  "ready-execute": { label: "Prête à exécuter", tone: "info" },
  "done-success": { label: "Exécutée", tone: "success" },
  "done-failed": { label: "Échec — à reprendre", tone: "danger" },
  stale: { label: "Simulation obsolète", tone: "danger" },
};

type PricePayload = {
  productId: string;
  variantId: string;
  currentPrice: number | null;
  supplierCost: number | null;
  shippingCost: number | null;
  paymentFeesRate: number | null;
  otherFixedCost: number | null;
  supplierCostSource?: "shopify_unit_cost" | "cost_assumption" | "unavailable";
};
type StockPayload = { variantId: string; storeStock: number | null; dailyVelocity: number | null };
// Mission agrégée par produit (>1 variante en rupture/rupture imminente) —
// voir recommendations.ts (groupStockByProduct). `storeStock` est la somme
// des stocks connus des variantes du groupe ; `dailyVelocity` est capturée
// UNE SEULE FOIS par produit (SalesSnapshot est au niveau produit, pas
// variante — sommer la même valeur N fois serait un bug), jamais sommée.
type AggregateStockPayload = {
  productId: string;
  variantIds: string[];
  variantCount: number;
  storeStock: number | null;
  dailyVelocity: number | null;
};

export interface SerializedActionItem {
  id: string;
  type: string;
  sensitivity: "SENSITIVE" | "SAFE";
  status: ActionStatus;
  payload: Record<string, unknown>;
  resultJson: string | null;
  createdAt: string;
  confirmedAt: string | null;
  executedAt: string | null;
}

const CATEGORY_LABEL: Record<string, string> = {
  stock: "Stock",
  margin: "Marge",
  reviews: "Avis",
  marketing: "Marketing",
  data_quality: "Qualité des données",
  content: "Contenu produit",
};

/**
 * Decision Workspace — ferme la boucle complète du Command Center sans
 * changer de page : SIGNAL → POURQUOI → SIMULATION → DÉCISION → VALIDATION
 * → EXÉCUTION → RÉSULTAT.
 *
 * Orchestrateur d'état + logique de décision ; le rendu de chaque section
 * est délégué à des composants dédiés sous `components/decision/`
 * (EvidencePanel, SimulationPanel, ResultPanel, ActionKindBadge) pour garder
 * la logique métier hors des composants visuels autant que possible.
 *
 * Ne réimplémente RIEN du moteur existant : réutilise tel quel
 * /api/actions (préparation), /api/actions/[id]/confirm (validation
 * humaine, capture du snapshot de simulation), /api/actions/[id]/execute
 * (exécution réelle, vérification du snapshot, mutation Shopify, audit).
 * Réutilise analyzeMargin/analyzeStock via simulatePriceChange /
 * simulateRestock — aucune nouvelle formule.
 *
 * Reprend l'état exact d'une ActionItem déjà préparée pour cette
 * recommandation (passée en prop `existingAction`) plutôt que de repartir
 * de zéro. Pour un groupe de plusieurs recommandations, propose une
 * expansion inline (chaque item devient sa propre Decision Card à un seul
 * élément, récursivement, sans navigation vers une autre page).
 */
export default function DecisionCard({
  group,
  storeId,
  existingAction = null,
  actionsByRecommendation = {},
  nested = false,
  defaultCollapsed = false,
  hideWorkspaceLink = false,
}: {
  group: RecommendationGroup;
  storeId: string;
  existingAction?: SerializedActionItem | null;
  /** Toutes les ActionItem connues (pas seulement celle du représentant) — utilisé pour la reprise d'état lors de l'expansion inline d'un groupe. */
  actionsByRecommendation?: Record<string, SerializedActionItem>;
  nested?: boolean;
  /** Carte repliée par défaut (en-tête seul : signal, titre, prochaine action, état) — ouverte au clic ou dès qu'une décision est engagée. */
  defaultCollapsed?: boolean;
  /** Masque le lien "Fiche complète" — la page /decisions/[recommendationId] (lot 7) l'utilise déjà pour se rendre elle-même, un lien vers elle-même n'aurait aucun sens. */
  hideWorkspaceLink?: boolean;
}) {
  const meta = SEVERITY_META[group.severity as keyof typeof SEVERITY_META] ?? SEVERITY_META.SUGGESTION;
  const Icon = meta.icon;
  const router = useRouter();
  const { representative, items } = group;
  const singleton = items.length === 1;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [open, setOpen] = useState(!defaultCollapsed);
  const [phase, setPhase] = useState<DecisionPhase>(() =>
    derivePhaseFromExistingAction(existingAction ? { status: existingAction.status, sensitivity: existingAction.sensitivity, resultJson: existingAction.resultJson } : null),
  );
  const [actionId, setActionId] = useState<string | null>(existingAction?.id ?? null);
  const [sensitive, setSensitive] = useState(existingAction ? existingAction.sensitivity === "SENSITIVE" : false);
  const [result, setResult] = useState<DisplayResult | null>(existingAction?.resultJson ? (JSON.parse(existingAction.resultJson) as DisplayResult) : null);
  const [resultAt, setResultAt] = useState<string | null>(existingAction?.executedAt ?? null);
  // Prédiction persistée à la confirmation — reprise depuis l'ActionItem
  // existante, ou reçue de /confirm dans la même session.
  const [prediction, setPrediction] = useState<PricePrediction | null>(() =>
    existingAction && isPricePrediction(existingAction.payload.prediction) ? existingAction.payload.prediction : null,
  );

  const payload: Record<string, unknown> | null = representative.actionPayloadJson
    ? (JSON.parse(representative.actionPayloadJson) as Record<string, unknown>)
    : null;

  const actionKind = actionKindFor(representative.actionType);
  const isPriceSim = singleton && representative.actionType === "update_price" && !!payload;
  // "variantId" (singulier) distingue une mission mono-variante (simulation
  // de réassort possible) d'une mission agrégée par produit (payload
  // "variantIds" pluriel, voir recommendations.ts) — pour laquelle simuler
  // "et si je reçois N unités ?" n'a pas de sens univoque (laquelle des N
  // variantes recevrait le réassort ?).
  const isRestockSim = singleton && representative.actionType === "review_supplier" && !!payload && "variantId" in (payload ?? {});
  const isAggregateStock = singleton && representative.actionType === "review_supplier" && !!payload && "variantIds" in (payload ?? {});
  const canSimulate = isPriceSim || isRestockSim;

  const pricePayload = isPriceSim ? (payload as unknown as PricePayload) : null;
  const stockPayload = isRestockSim ? (payload as unknown as StockPayload) : null;
  const aggregateStockPayload = isAggregateStock ? (payload as unknown as AggregateStockPayload) : null;

  const [candidatePrice, setCandidatePrice] = useState(() => {
    if (existingAction?.payload && typeof existingAction.payload.newPrice === "number") return String(existingAction.payload.newPrice);
    return pricePayload?.currentPrice != null ? String(pricePayload.currentPrice) : "";
  });
  const [candidateUnits, setCandidateUnits] = useState("");

  // Simulation calculée en direct (fonction pure, pas d'appel réseau) —
  // jamais stockée séparément pour ne jamais afficher un résultat qui ne
  // correspond plus à l'entrée courante.
  const priceSim =
    isPriceSim && pricePayload && candidatePrice.trim() !== ""
      ? simulatePriceChange({
          productId: pricePayload.productId,
          variantId: pricePayload.variantId,
          title: representative.title,
          currentPrice: pricePayload.currentPrice,
          supplierCost: pricePayload.supplierCost,
          shippingCost: pricePayload.shippingCost,
          paymentFeesRate: pricePayload.paymentFeesRate,
          otherFixedCost: pricePayload.otherFixedCost,
          supplierCostSource: pricePayload.supplierCostSource,
          candidatePrice: Number(candidatePrice),
        })
      : null;
  const restockSim =
    isRestockSim && stockPayload && candidateUnits.trim() !== ""
      ? simulateRestock({
          productId: group.product?.id,
          variantId: stockPayload.variantId,
          title: representative.title,
          currentStock: stockPayload.storeStock,
          dailyVelocity: stockPayload.dailyVelocity,
          candidateAddedUnits: Number(candidateUnits),
        })
      : null;

  const dataPoints: DataPoint[] = [];
  if (pricePayload) {
    dataPoints.push({ label: "Prix actuel", value: pricePayload.currentPrice != null ? `${pricePayload.currentPrice.toFixed(2)} €` : "N/D", status: pricePayload.currentPrice != null ? "real" : "unavailable" });
    dataPoints.push({
      label: pricePayload.supplierCostSource === "shopify_unit_cost" ? "Coût réel Shopify" : "Coût fournisseur",
      value: pricePayload.supplierCost != null ? `${pricePayload.supplierCost.toFixed(2)} €` : "N/D",
      status: pricePayload.supplierCost == null ? "unavailable" : pricePayload.supplierCostSource === "shopify_unit_cost" ? "real" : "estimated",
    });
    dataPoints.push({ label: "Transport", value: pricePayload.shippingCost != null ? `${pricePayload.shippingCost.toFixed(2)} €` : "Non renseigné", status: pricePayload.shippingCost != null ? "estimated" : "unavailable" });
  } else if (stockPayload) {
    dataPoints.push({ label: "Stock actuel", value: stockPayload.storeStock != null ? `${stockPayload.storeStock} unité(s)` : "N/D", status: stockPayload.storeStock != null ? "real" : "unavailable" });
    dataPoints.push({
      label: "Vélocité de vente",
      value:
        stockPayload.dailyVelocity != null
          ? `≈ ${(stockPayload.dailyVelocity * 7).toFixed(1)} ventes / 7 j (moy. 30 j)`
          : "Inconnue — pas d'historique de ventes",
      status: stockPayload.dailyVelocity != null ? "calculated" : "unavailable",
    });
  } else if (aggregateStockPayload) {
    dataPoints.push({ label: "Variantes concernées", value: `${aggregateStockPayload.variantCount}`, status: "real" });
    dataPoints.push({ label: "Stock cumulé", value: aggregateStockPayload.storeStock != null ? `${aggregateStockPayload.storeStock} unité(s)` : "N/D", status: aggregateStockPayload.storeStock != null ? "real" : "unavailable" });
    dataPoints.push({
      label: "Vélocité de vente (produit)",
      value:
        aggregateStockPayload.dailyVelocity != null
          ? `≈ ${(aggregateStockPayload.dailyVelocity * 7).toFixed(1)} ventes / 7 j (moy. 30 j, toutes variantes confondues)`
          : "Inconnue — pas d'historique de ventes",
      status: aggregateStockPayload.dailyVelocity != null ? "calculated" : "unavailable",
    });
  }
  dataPoints.push({ label: "Confiance de la règle", value: `${group.confidence}%` });

  async function dismissAll() {
    setBusy(true);
    await Promise.all(items.map((r) => fetch(`/api/recommendations/${r.id}/dismiss`, { method: "POST" })));
    setBusy(false);
    router.refresh();
  }

  async function prepareAction() {
    if (!representative.actionType) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/actions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ storeId, recommendationId: representative.id }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok || !data.ok) {
      setError(data.error ?? "Échec de préparation de l'action.");
      return;
    }
    setActionId(data.actionId);
    const isSensitive = isSensitiveActionType(representative.actionType);
    setSensitive(isSensitive);
    if (isSensitive) {
      setPhase("confirm");
    } else {
      await executeNow(data.actionId);
    }
  }

  async function confirmAndExecute() {
    if (!actionId) return;
    setBusy(true);
    setError(null);
    const params: Record<string, unknown> = {};
    if (representative.actionType === "update_price") {
      const price = priceSim && priceSim.available ? priceSim.after.sellingPrice : Number(candidatePrice);
      if (!price || Number(price) <= 0) {
        setError("Indiquez un prix candidat valide avant de confirmer.");
        setBusy(false);
        return;
      }
      params.newPrice = Number(price);
    }
    const confirmRes = await fetch(`/api/actions/${actionId}/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ params }),
    });
    const confirmData = await confirmRes.json().catch(() => ({}));
    if (!confirmRes.ok) {
      setError(confirmData.error ?? "Échec de confirmation.");
      setBusy(false);
      return;
    }
    try {
      const confirmedPayload = JSON.parse(confirmData.action?.payloadJson ?? "{}") as Record<string, unknown>;
      if (isPricePrediction(confirmedPayload.prediction)) setPrediction(confirmedPayload.prediction);
    } catch {
      // payload illisible : pas de prédiction affichée, jamais une valeur inventée
    }
    await executeNow(actionId);
  }

  async function executeNow(id: string) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/actions/${id}/execute`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    setResultAt(new Date().toISOString());
    if (!res.ok || !data.ok) {
      setResult(data as DisplayResult);
      setPhase(data.kind === "stale_simulation" ? "stale" : "done-failed");
      return;
    }
    setResult(data as DisplayResult);
    setPhase("done-success");
    // Rafraîchit les données serveur (compteurs, historique) sans faire
    // disparaître ce panneau : le résultat reste affiché tel quel, seule la
    // recommandation quitte la liste « Priorités du jour » à la prochaine
    // navigation puisqu'elle est désormais ACTIONED.
    router.refresh();
  }

  function resetForNewDecision() {
    setPhase("signal");
    setActionId(null);
    setResult(null);
    setError(null);
    setPrediction(null);
  }

  const phaseMeta = PHASE_META[phase];
  const nextActionLabel =
    phase === "signal"
      ? representative.actionLabel ?? "Aucune action exécutable"
      : phase === "confirm"
        ? "Valider la décision"
        : phase === "ready-execute"
          ? actionKind === "automated_mutation"
            ? "Exécuter sur Shopify"
            : "Marquer la mission comme effectuée"
          : phase === "done-success"
            ? "Terminé"
            : "Reprendre la décision";
  const isOpen = open || phase !== "signal";

  return (
    <article className={`decision ${meta.cls}${nested ? " decision-nested" : ""}${isOpen ? " is-open" : " is-collapsed"}`} data-phase={phase}>
      <header className="decision-head">
        <div className={`decision-head-icon decision-head-icon-${meta.cls}`} aria-hidden="true">
          <Icon size={16} strokeWidth={2} />
        </div>
        <div className="decision-head-body">
          <div className="decision-head-badges">
            <Badge tone={meta.tone}>{meta.label}</Badge>
            <Badge tone="neutral">{CATEGORY_LABEL[representative.category] ?? representative.category}</Badge>
            {items.length > 1 && <span className="priority-card-group-count">{items.length} recommandations groupées</span>}
            {singleton && representative.actionType && <ActionKindBadge kind={actionKind} />}
            <span className={`phase-pill phase-pill-${phaseMeta.tone}`}>{phaseMeta.label}</span>
          </div>
          <h3 className="decision-head-title">{group.title}</h3>
          {group.product && <div className="decision-head-product">Produit : {group.product.title}</div>}
          {group.impactScore !== null && (
            <div className="decision-head-product cell-sub">
              Impact estimé : ~{Math.round(group.impactScore).toLocaleString("fr-FR")} €/semaine{" "}
              {group.impactCoverage < 1 ? `(sur ${Math.round(group.impactCoverage * items.length)}/${items.length} variantes)` : ""} <DataTag status="estimated" compact />
            </div>
          )}
          <div className="decision-head-next">
            <span className="decision-head-next-label">Prochaine action</span>
            <span className="decision-head-next-value">{nextActionLabel}</span>
          </div>
        </div>
        <div className="decision-head-actions">
          {phase === "signal" && singleton && representative.actionLabel && representative.actionType && (
            <Button variant="primary" size="sm" disabled={busy} onClick={prepareAction}>
              {busy ? "…" : "Décider"}
            </Button>
          )}
          {phase === "confirm" && (
            <Button variant="primary" size="sm" disabled={busy} onClick={confirmAndExecute}>
              {busy ? "…" : "Confirmer l'action"}
            </Button>
          )}
          {phase === "ready-execute" && (
            <Button variant="primary" size="sm" disabled={busy} onClick={() => actionId && executeNow(actionId)}>
              {busy ? "…" : actionKind === "automated_mutation" ? "Exécuter maintenant" : "Marquer comme effectué"}
            </Button>
          )}
          {!singleton && phase === "signal" && !nested && (
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => { setOpen(true); setExpanded((e) => !e); }}>
              {expanded ? "Réduire" : `Examiner les ${items.length}`}
            </Button>
          )}
          {(phase === "signal" || phase === "confirm") && (
            <Button variant="secondary" size="sm" disabled={busy} onClick={dismissAll}>
              {items.length > 1 ? `Ignorer les ${items.length}` : "Ignorer"}
            </Button>
          )}
          {phase === "signal" && singleton && (
            <button type="button" className="decision-toggle" aria-expanded={isOpen} onClick={() => setOpen((o) => !o)}>
              {isOpen ? "Réduire" : "Détails"}
            </button>
          )}
          {!nested && !hideWorkspaceLink && (
            <Link href={`/decisions/${representative.id}?store=${storeId}`} className="decision-toggle">
              Fiche complète
            </Link>
          )}
        </div>
      </header>

      {isOpen && (
        <div className="decision-body">
          {singleton && representative.actionType && <DecisionStepper phase={phase} kind={actionKind} />}

          {phase !== "done-success" && phase !== "done-failed" && phase !== "stale" && (
            <>
              {singleton && representative.actionType && (
                <div className="decision-section">
                  <div className="decision-section-label">Scénario et variation</div>
                  {canSimulate ? (
                    <SimulationPanel
                      isPriceSim={isPriceSim}
                      isRestockSim={isRestockSim}
                      candidatePrice={candidatePrice}
                      candidateUnits={candidateUnits}
                      onCandidatePriceChange={setCandidatePrice}
                      onCandidateUnitsChange={setCandidateUnits}
                      inputsDisabled={phase !== "signal" && phase !== "confirm"}
                      priceSim={priceSim}
                      restockSim={restockSim}
                      currentStock={stockPayload?.storeStock ?? null}
                    />
                  ) : (
                    <p className="unavailable-note">Impact chiffré non disponible pour ce type de recommandation.</p>
                  )}
                </div>
              )}

              <EvidencePanel dataPoints={dataPoints} reason={representative.reason} impact={representative.impact} groupCount={items.length} />

              {phase === "confirm" && (
                <div className="decision-section decision-validation" role="status">
                  <div className="decision-section-label">Validation humaine</div>
                  <p>
                    Cette action va modifier votre boutique Shopify. Vous pouvez encore ajuster le scénario ci-dessus ; en confirmant, OnDeal capture les
                    données réelles et la prédiction, puis exécute l&apos;action et vérifie le résultat.
                  </p>
                </div>
              )}
              {phase === "ready-execute" && (
                <div className="decision-section decision-validation" role="status">
                  <div className="decision-section-label">{actionKind === "automated_mutation" ? "Prête à exécuter" : "Mission à réaliser"}</div>
                  <p>
                    {actionKind === "automated_mutation"
                      ? `Action préparée${existingAction?.confirmedAt ? " et confirmée" : ""} — les données seront revérifiées juste avant la mutation Shopify.`
                      : `Mission préparée${existingAction?.confirmedAt ? " et confirmée" : ""} — à réaliser par vous, puis à marquer comme effectuée.`}
                  </p>
                </div>
              )}

              {!singleton && expanded && (
                <div className="decision-group-expansion">
                  {items.filter((item) => item.reason !== "").length < items.length && (
                    <p className="unavailable-note" style={{ marginBottom: 8 }}>
                      {items.filter((item) => item.reason !== "").length} premières recommandations détaillées ici sur {items.length} — la liste complète est dans le
                      Centre d&apos;intelligence.
                    </p>
                  )}
                  {items
                    .filter((item) => item.reason !== "")
                    .map((item) => (
                      <DecisionCard
                        key={item.id}
                        group={{
                          key: item.id,
                          category: item.category,
                          severity: item.severity,
                          product: item.product ?? group.product ?? null,
                          items: [item],
                          title: item.title,
                          confidence: item.confidence,
                          representative: item,
                          impactScore: item.impactScore ?? null,
                          impactCoverage: item.impactScore != null ? 1 : 0,
                        }}
                        storeId={storeId}
                        existingAction={actionsByRecommendation[item.id] ?? null}
                        actionsByRecommendation={actionsByRecommendation}
                        nested
                      />
                    ))}
                </div>
              )}
            </>
          )}

          {(phase === "done-success" || phase === "done-failed" || phase === "stale") && result && (
            <ResultPanel phase={phase} result={result} resultAt={resultAt} onRetry={resetForNewDecision} prediction={prediction} />
          )}

          {error && (
            <div className="callout callout-error" style={{ marginTop: 8, marginBottom: 0 }} role="alert">
              {error}
            </div>
          )}
        </div>
      )}
    </article>
  );
}
