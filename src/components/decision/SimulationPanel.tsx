import { ArrowRight } from "lucide-react";
import type { PriceSimulationResult, RestockSimulationResult } from "@/lib/intelligence/simulate";
import PriceScenarioTable from "@/components/decision/PriceScenarioTable";

/**
 * Section SIMULATION — pur affichage du résultat déjà calculé par
 * `simulatePriceChange`/`simulateRestock` (aucun recalcul ici). AVANT →
 * ACTION → APRÈS avec l'impact mesurable, ou l'explication exacte de ce qui
 * manque pour simuler — jamais un nombre approché à la place.
 */
export default function SimulationPanel({
  isPriceSim,
  isRestockSim,
  candidatePrice,
  candidateUnits,
  onCandidatePriceChange,
  onCandidateUnitsChange,
  inputsDisabled,
  priceSim,
  restockSim,
  currentStock,
}: {
  isPriceSim: boolean;
  isRestockSim: boolean;
  candidatePrice: string;
  candidateUnits: string;
  onCandidatePriceChange: (v: string) => void;
  onCandidateUnitsChange: (v: string) => void;
  inputsDisabled: boolean;
  priceSim: PriceSimulationResult | null;
  restockSim: RestockSimulationResult | null;
  currentStock: number | null;
}) {
  return (
    <div className="decision-sim">
      {isPriceSim && (
        <div className="field">
          <label>Prix candidat (€)</label>
          <input
            className="input"
            type="number"
            step="0.01"
            value={candidatePrice}
            disabled={inputsDisabled}
            onChange={(e) => onCandidatePriceChange(e.target.value)}
          />
        </div>
      )}
      {isRestockSim && (
        <div className="field">
          <label>Unités reçues (simulation)</label>
          <input
            className="input"
            type="number"
            step="1"
            placeholder="ex. 20"
            value={candidateUnits}
            disabled={inputsDisabled}
            onChange={(e) => onCandidateUnitsChange(e.target.value)}
          />
        </div>
      )}

      {isPriceSim &&
        (priceSim ? (
          priceSim.available ? (
            <PriceScenarioTable sim={priceSim} candidatePrice={Number(candidatePrice)} />
          ) : (
            <p className="decision-sim-hint">{priceSim.reason}</p>
          )
        ) : (
          <p className="decision-sim-hint">Indiquez un prix candidat pour voir l&apos;impact sur la marge brute (et complète si les hypothèses sont renseignées).</p>
        ))}

      {isRestockSim &&
        (restockSim ? (
          restockSim.available ? (
            <>
              <div className="decision-sim-row">
                <div className="decision-sim-col">
                  <div className="decision-sim-col-label">Avant</div>
                  <div className="decision-sim-col-value">{currentStock ?? 0} unités</div>
                </div>
                <ArrowRight size={16} className="decision-sim-arrow" />
                <div className="decision-sim-col action">
                  <div className="decision-sim-col-label">Action</div>
                  <div className="decision-sim-col-value">+{candidateUnits} unités</div>
                </div>
                <ArrowRight size={16} className="decision-sim-arrow" />
                <div className="decision-sim-col">
                  <div className="decision-sim-col-label">Après</div>
                  <div className="decision-sim-col-value">{restockSim.projectedStock} unités</div>
                </div>
              </div>
              {restockSim.projectedDaysOfStock !== null && (
                <div className="decision-sim-impact positive">
                  Impact : ≈ {Math.round(restockSim.projectedDaysOfStock)} jour(s) de couverture ({restockSim.projectedStatus.replace(/_/g, " ")})
                </div>
              )}
            </>
          ) : (
            <p className="decision-sim-hint">{restockSim.reason}</p>
          )
        ) : (
          <p className="decision-sim-hint">Indiquez une quantité pour voir la couverture de stock projetée.</p>
        ))}
    </div>
  );
}
