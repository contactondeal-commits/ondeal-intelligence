"use client";

import { useState } from "react";
import { simulatePriceChange, type PriceSimulationInput } from "@/lib/intelligence/simulate";
import PriceScenarioTable from "@/components/decision/PriceScenarioTable";

/**
 * Simulateur autonome d'une variante (Decision Workspace sans signal ouvert)
 * — même fonction pure `simulatePriceChange` que la Decision Card, aucun
 * appel réseau, aucun recalcul divergent. N'engage aucune action : la
 * décision passe toujours par une recommandation et le flux Phase 3.
 */
export default function PriceSimulator({ input }: { input: Omit<PriceSimulationInput, "candidatePrice"> }) {
  const [candidate, setCandidate] = useState(input.currentPrice !== null ? String(input.currentPrice) : "");
  const sim = candidate.trim() !== "" ? simulatePriceChange({ ...input, candidatePrice: Number(candidate) }) : null;

  return (
    <div className="simulator">
      <label className="field simulator-input">
        <span>Nouveau prix (€)</span>
        <input className="input" type="number" min="0" step="0.01" value={candidate} onChange={(e) => setCandidate(e.target.value)} />
      </label>
      {sim ? (
        sim.available ? (
          <PriceScenarioTable sim={sim} candidatePrice={Number(candidate)} />
        ) : (
          <p className="decision-sim-hint">{sim.reason}</p>
        )
      ) : (
        <p className="decision-sim-hint">Indiquez un nouveau prix pour comparer l&apos;état actuel et le scénario.</p>
      )}
    </div>
  );
}
