import { CheckCircle2, AlertTriangle, RefreshCw, Minus } from "lucide-react";
import Button from "@/components/ui/Button";
import DataTag from "@/components/ui/DataTag";
import type { PriceOutcomeMeasurement, PricePrediction } from "@/lib/intelligence/prediction";

function eur(v: number | null | undefined): string {
  return v === null || v === undefined ? "—" : `${v.toFixed(2)} €`;
}
function fmtDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString("fr-FR") : "—";
}
function fmtValue(v: number | string | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return typeof v === "number" ? `${v.toFixed(2)} €` : String(v);
}

export interface DisplayResult {
  detail: string;
  kind?: string;
  verification?: string;
  before?: number | string | null;
  applied?: number | string;
  verified?: number | string;
  changedFields?: Array<{ field: string; label: string; expected: number | null; actual: number | null }>;
  /** PREDICTION → RESULT → GAP (update_price) — voir prediction.ts. */
  measurement?: PriceOutcomeMeasurement;
}

type StageState = "done" | "failed" | "unavailable" | "pending" | "info";

interface Stage {
  key: string;
  label: string;
  value: string;
  sub?: string;
  state: StageState;
  tag?: "real" | "calculated" | "estimated" | "unavailable";
}

/**
 * Les six étapes du RÉSULTAT, toujours dans le même ordre, quel que soit le
 * kind réel : PRÉVU → APPLIQUÉ → VÉRIFIÉ → RÉSULTAT → ÉCART → PROCHAINE
 * MESURE. Chaque étape n'affiche que ce que le moteur a réellement produit
 * (prédiction persistée, valeur envoyée, valeur relue de Shopify, statut,
 * écart calculé, mesure différée) — sinon « — » ou « indisponible ».
 */
function buildStages(phase: "done-success" | "done-failed" | "stale", result: DisplayResult, prediction: PricePrediction | null): Stage[] {
  const m = result.measurement;
  const automated = result.kind === "automated_mutation";
  const manual = result.kind === "manual_mission_completed";

  const predicted: Stage = prediction
    ? {
        key: "predicted",
        label: "Prévu",
        value: eur(prediction.newPrice),
        sub: `marge brute ${eur(prediction.grossMarginAfter)}${prediction.marginAfter !== null ? ` · complète ${eur(prediction.marginAfter)}` : ""}`,
        state: "info",
        tag: "calculated",
      }
    : { key: "predicted", label: "Prévu", value: manual ? "Mission" : "—", sub: manual ? "aucune mutation prévue" : "aucune prédiction persistée", state: manual ? "info" : "unavailable" };

  if (phase === "done-success" && automated) {
    return [
      predicted,
      { key: "applied", label: "Appliqué", value: fmtValue(result.applied), sub: `avant : ${fmtValue(result.before)}`, state: "done", tag: "real" },
      { key: "verified", label: "Vérifié", value: fmtValue(result.verified), sub: "relu de Shopify", state: "done", tag: "real" },
      { key: "result", label: "Résultat", value: "Exécutée", sub: "EXECUTED", state: "done" },
      m
        ? {
            key: "gap",
            label: "Écart",
            value: m.gap.structuralMatch ? "Conforme" : `${m.gap.price >= 0 ? "+" : ""}${m.gap.price.toFixed(2)} €`,
            sub: m.gap.structuralMatch ? "prix et marge brute" : "voir détail",
            state: m.gap.structuralMatch ? "done" : "failed",
            tag: "calculated",
          }
        : { key: "gap", label: "Écart", value: "—", sub: "aucune prédiction", state: "unavailable" },
      m
        ? {
            key: "next",
            label: m.deferred.status === "available" ? "Effet réel sur les ventes" : "Prochaine mesure",
            value: m.deferred.status === "available" ? "Ventes comparées" : "Ventes : insuffisant",
            sub: `${m.deferred.windowDays} j avant / après`,
            state: m.deferred.status === "available" ? "done" : "pending",
            tag: m.deferred.status === "available" ? "real" : "unavailable",
          }
        : { key: "next", label: "Prochaine mesure", value: "—", state: "unavailable" },
    ];
  }
  if (phase === "done-success" && manual) {
    return [
      predicted,
      { key: "applied", label: "Appliqué", value: "Aucune mutation", sub: "mission manuelle", state: "info" },
      { key: "verified", label: "Vérifié", value: "—", sub: "pas de vérification Shopify", state: "unavailable" },
      { key: "result", label: "Résultat", value: "Prise en charge", sub: "EXECUTED", state: "done" },
      { key: "gap", label: "Écart", value: "—", state: "unavailable" },
      { key: "next", label: "Prochaine mesure", value: "Prochaine synchronisation", sub: "stock / vélocité", state: "pending" },
    ];
  }
  if (phase === "stale") {
    return [
      predicted,
      { key: "applied", label: "Appliqué", value: "Rien", sub: "exécution refusée", state: "failed" },
      { key: "verified", label: "Vérifié", value: "Données changées", sub: `${result.changedFields?.length ?? 0} champ(s)`, state: "failed", tag: "real" },
      { key: "result", label: "Résultat", value: "Obsolète", sub: "FAILED · stale_simulation", state: "failed" },
      { key: "gap", label: "Écart", value: "—", state: "unavailable" },
      { key: "next", label: "Prochaine mesure", value: "Nouvelle simulation", state: "pending" },
    ];
  }
  return [
    predicted,
    { key: "applied", label: "Appliqué", value: "Rien", sub: "aucune modification", state: "failed" },
    { key: "verified", label: "Vérifié", value: "—", state: "unavailable" },
    { key: "result", label: "Résultat", value: "Échec", sub: "FAILED", state: "failed" },
    { key: "gap", label: "Écart", value: "—", state: "unavailable" },
    { key: "next", label: "Prochaine mesure", value: "Reprendre", sub: "nouvelle décision", state: "pending" },
  ];
}

function StageIcon({ state }: { state: StageState }) {
  if (state === "done") return <CheckCircle2 size={14} />;
  if (state === "failed") return <AlertTriangle size={14} />;
  if (state === "pending") return <RefreshCw size={14} />;
  return <Minus size={14} />;
}

function MeasurementDetail({ m }: { m: PriceOutcomeMeasurement }) {
  const d = m.deferred;
  // Delta en % — jamais calculé si "avant" est à 0 (division par zéro) ; le
  // statut "available" garantit déjà unitsBefore >= le seuil minimal, donc > 0 ici.
  const deltaUnitsPct = d.status === "available" && d.unitsBefore !== null && d.unitsBefore > 0 && d.unitsAfter !== null ? ((d.unitsAfter - d.unitsBefore) / d.unitsBefore) * 100 : null;
  return (
    <div className="measurement">
      <div className="measurement-title">Prédiction et résultat structurel</div>
      <table className="scenario-table">
        <thead>
          <tr>
            <th scope="col"></th>
            <th scope="col">Prévu (à la validation)</th>
            <th scope="col">Observé (après Shopify)</th>
            <th scope="col">Écart</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">
              Prix <DataTag status="real" compact />
            </th>
            <td>{eur(m.predicted.newPrice)}</td>
            <td>{eur(m.observed.appliedPrice)}</td>
            <td className={Math.abs(m.gap.price) > 0.01 ? "is-negative" : ""}>
              {m.gap.price >= 0 ? "+" : ""}
              {m.gap.price.toFixed(2)} €
            </td>
          </tr>
          <tr>
            <th scope="row">
              Coût fournisseur <DataTag status={m.observed.supplierCostSource === "shopify_unit_cost" ? "real" : m.observed.supplierCost === null ? "unavailable" : "estimated"} compact />
            </th>
            <td>—</td>
            <td>{eur(m.observed.supplierCost)}</td>
            <td>—</td>
          </tr>
          <tr className="scenario-row-strong">
            <th scope="row">
              Marge brute <DataTag status="calculated" compact />
            </th>
            <td>{eur(m.predicted.grossMarginAfter)}</td>
            <td>{eur(m.observed.grossMargin)}</td>
            <td className={m.gap.grossMargin !== null && Math.abs(m.gap.grossMargin) > 0.01 ? "is-negative" : ""}>
              {m.gap.grossMargin === null ? "—" : `${m.gap.grossMargin >= 0 ? "+" : ""}${m.gap.grossMargin.toFixed(2)} €`}
            </td>
          </tr>
        </tbody>
      </table>
      <div className={`measurement-verdict ${m.gap.structuralMatch ? "is-match" : "is-gap"}`}>{m.gap.explanation}</div>
      <div className="measurement-deferred">
        <DataTag status={d.status === "available" ? "real" : "unavailable"} compact /> Effet sur les ventes ({d.windowDays} j avant/après) :{" "}
        {d.status === "available"
          ? `${d.unitsBefore} → ${d.unitsAfter} unité(s) vendue(s)${deltaUnitsPct !== null ? ` (${deltaUnitsPct >= 0 ? "+" : ""}${deltaUnitsPct.toFixed(0)} %)` : ""}`
          : d.reason}
      </div>
    </div>
  );
}

/**
 * Section RÉSULTAT — six étapes explicites, puis le détail propre au kind
 * réel (mesure prédiction/résultat, champs devenus obsolètes, message
 * d'échec) et la reprise. Jamais un chiffre fictif.
 */
export default function ResultPanel({
  phase,
  result,
  resultAt,
  onRetry,
  prediction = null,
}: {
  phase: "done-success" | "done-failed" | "stale";
  result: DisplayResult;
  resultAt: string | null;
  onRetry: () => void;
  /** Prédiction persistée à la validation (payload.prediction) — affichée telle quelle, même quand l'action a échoué. */
  prediction?: PricePrediction | null;
}) {
  const stages = buildStages(phase, result, prediction);
  const tone = phase === "done-success" ? "success" : phase === "stale" ? "stale" : "failed";
  const title =
    phase === "done-success"
      ? result.kind === "manual_mission_completed"
        ? "Mission marquée comme effectuée"
        : "Action exécutée et vérifiée"
      : phase === "stale"
        ? "Simulation obsolète — exécution refusée"
        : "Action non exécutée";

  return (
    <div className={`decision-result decision-result-${tone}`}>
      <div className="decision-result-title">
        {phase === "done-success" ? <CheckCircle2 size={16} /> : phase === "stale" ? <RefreshCw size={16} /> : <AlertTriangle size={16} />} {title}
      </div>

      <ol className="result-flow" aria-label="Résultat de la décision, étape par étape">
        {stages.map((s) => (
          <li key={s.key} className={`result-stage is-${s.state}`}>
            <div className="result-stage-head">
              <StageIcon state={s.state} />
              <span className="result-stage-label">{s.label}</span>
              {s.tag && <DataTag status={s.tag} compact />}
            </div>
            <div className="result-stage-value">{s.value}</div>
            {s.sub && <div className="result-stage-sub">{s.sub}</div>}
          </li>
        ))}
      </ol>

      <div className="decision-result-detail">{result.detail}</div>
      {result.verification && <div className="decision-result-detail">Shopify vérifié — {result.verification}</div>}

      {phase === "stale" && result.changedFields && result.changedFields.length > 0 && (
        <div className="decision-result-grid">
          {result.changedFields.map((c) => (
            <div className="decision-result-field" key={c.field}>
              <span>{c.label}</span>
              <strong>
                {c.expected ?? "—"} → {c.actual ?? "—"}
              </strong>
            </div>
          ))}
        </div>
      )}

      {prediction && (
        <div className="decision-result-predicted">
          <span className="decision-result-predicted-label">Prédiction persistée le {fmtDate(prediction.predictedAt)}</span>
          <span>
            Prix {eur(prediction.priceBefore)} → {eur(prediction.newPrice)} · marge brute {eur(prediction.grossMarginBefore)} → {eur(prediction.grossMarginAfter)}
            {prediction.marginAfter !== null ? ` · marge complète (hypothèses) ${eur(prediction.marginBefore)} → ${eur(prediction.marginAfter)}` : ""}
            {" · coût "}
            {prediction.supplierCostSource === "shopify_unit_cost" ? "réel Shopify" : prediction.supplierCostSource === "cost_assumption" ? "hypothèse OnDeal" : "indisponible"}
          </span>
        </div>
      )}

      {result.measurement && <MeasurementDetail m={result.measurement} />}

      <div className="decision-result-meta">
        {phase === "done-success"
          ? `${result.kind === "manual_mission_completed" ? "Confirmé" : "Exécuté"} le ${fmtDate(resultAt)} — recommandation résolue${result.kind === "manual_mission_completed" ? " — aucune mutation Shopify effectuée par OnDeal" : ""}.`
          : phase === "stale"
            ? `Refusé le ${fmtDate(resultAt)} — aucune modification appliquée sur Shopify.`
            : `Statut FAILED le ${fmtDate(resultAt)} — aucune modification appliquée sur Shopify.`}
      </div>

      {(phase === "stale" || phase === "done-failed") && (
        <Button variant="secondary" size="sm" style={{ marginTop: 8 }} onClick={onRetry}>
          {phase === "stale" ? "Relancer une nouvelle simulation" : "Reprendre (nouvelle décision)"}
        </Button>
      )}
    </div>
  );
}
