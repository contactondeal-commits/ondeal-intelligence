import DataTag from "@/components/ui/DataTag";
import type { PriceSimulationResult } from "@/lib/intelligence/simulate";
import { supplierCostSourceLabel } from "@/lib/intelligence/costs";

function eur(v: number | null | undefined): string {
  return v === null || v === undefined ? "—" : `${v.toFixed(2)} €`;
}
function pct(v: number | null | undefined): string {
  return v === null || v === undefined ? "—" : `${(v * 100).toFixed(1)} %`;
}
function signed(v: number | null, unit: "€" | "pt"): string {
  if (v === null) return "—";
  const s = v > 0 ? "+" : "";
  return unit === "€" ? `${s}${v.toFixed(2)} €` : `${s}${(v * 100).toFixed(1)} pt`;
}

/**
 * Tableau ÉTAT ACTUEL → SCÉNARIO → DELTA d'une simulation de prix. Pur
 * affichage du résultat de `simulatePriceChange` (aucun recalcul) : prix,
 * coût réel, marge brute, taux, nouveau prix, marge simulée, taux simulé,
 * variation absolue et relative. La simulation est COMPTABLE : elle ne
 * prédit ni les ventes ni le chiffre d'affaires, et le dit.
 */
export default function PriceScenarioTable({ sim, candidatePrice }: { sim: Extract<PriceSimulationResult, { available: true }>; candidatePrice: number }) {
  const b = sim.before;
  const a = sim.after;
  const deltaPrice = b.sellingPrice !== null ? candidatePrice - b.sellingPrice : null;
  const deltaPricePct = b.sellingPrice ? deltaPrice! / b.sellingPrice : null;
  const deltaGrossPct = b.grossMargin !== null && b.grossMargin !== 0 ? sim.deltaGrossMargin / Math.abs(b.grossMargin) : null;
  const grossTone = (m: number | null) => (m === null ? "" : m < 0 ? "is-negative" : "");

  return (
    <div className="scenario">
      <table className="scenario-table">
        <thead>
          <tr>
            <th scope="col"></th>
            <th scope="col">État actuel</th>
            <th scope="col">Scénario</th>
            <th scope="col">Variation</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">
              Prix de vente <DataTag status="real" compact />
            </th>
            <td>{eur(b.sellingPrice)}</td>
            <td className="scenario-candidate">{eur(candidatePrice)}</td>
            <td>
              {signed(deltaPrice, "€")}
              {deltaPricePct !== null && <span className="cell-sub"> ({signed(deltaPricePct, "pt").replace(" pt", " %")})</span>}
            </td>
          </tr>
          <tr>
            <th scope="row">
              Coût fournisseur <DataTag status={b.status.supplierCost} compact />
            </th>
            <td>
              {eur(b.supplierCost)} <span className="cell-sub">{supplierCostSourceLabel(b.supplierCostSource)}</span>
            </td>
            <td>{eur(a.supplierCost)}</td>
            <td>—</td>
          </tr>
          <tr className="scenario-row-strong">
            <th scope="row">
              Marge brute <DataTag status="calculated" compact />
            </th>
            <td className={grossTone(b.grossMargin)}>{eur(b.grossMargin)}</td>
            <td className={grossTone(a.grossMargin)}>{eur(a.grossMargin)}</td>
            <td className={sim.deltaGrossMargin < 0 ? "is-negative" : sim.deltaGrossMargin > 0 ? "is-positive" : ""}>
              {signed(sim.deltaGrossMargin, "€")}
              {deltaGrossPct !== null && <span className="cell-sub"> ({signed(deltaGrossPct, "pt").replace(" pt", " %")})</span>}
            </td>
          </tr>
          <tr>
            <th scope="row">Taux de marge brute</th>
            <td className={grossTone(b.grossMarginRate)}>{pct(b.grossMarginRate)}</td>
            <td className={grossTone(a.grossMarginRate)}>{pct(a.grossMarginRate)}</td>
            <td>{signed(sim.deltaGrossMarginRate, "pt")}</td>
          </tr>
          {sim.fullMarginAvailable ? (
            <>
              <tr>
                <th scope="row">
                  Transport + frais de paiement <DataTag status="estimated" compact />
                </th>
                <td>{eur((b.shippingCost ?? 0) + (b.paymentFees ?? 0) + (b.otherFixedCost ?? 0))}</td>
                <td>{eur((a.shippingCost ?? 0) + (a.paymentFees ?? 0) + (a.otherFixedCost ?? 0))}</td>
                <td>—</td>
              </tr>
              <tr className="scenario-row-strong">
                <th scope="row">
                  Marge complète <DataTag status="calculated" compact />
                </th>
                <td className={grossTone(b.margin)}>
                  {eur(b.margin)} <span className="cell-sub">({pct(b.marginRate)})</span>
                </td>
                <td className={grossTone(a.margin)}>
                  {eur(a.margin)} <span className="cell-sub">({pct(a.marginRate)})</span>
                </td>
                <td className={(sim.deltaMargin ?? 0) < 0 ? "is-negative" : (sim.deltaMargin ?? 0) > 0 ? "is-positive" : ""}>
                  {signed(sim.deltaMargin, "€")} <span className="cell-sub">({signed(sim.deltaMarginRate, "pt")})</span>
                </td>
              </tr>
            </>
          ) : (
            <tr>
              <th scope="row">
                Marge complète <DataTag status="unavailable" compact />
              </th>
              <td colSpan={3} className="cell-sub">
                {sim.fullMarginUnavailableReason}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <p className="scenario-note">
        Simulation comptable par unité vendue : elle ne prédit ni le volume de ventes, ni le chiffre d&apos;affaires, ni la marge réalisée — aucun
        modèle de demande n&apos;est disponible.
      </p>
    </div>
  );
}
