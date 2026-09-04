import { Check, AlertTriangle } from "lucide-react";
import type { DecisionPhase } from "@/lib/intelligence/decision";
import type { ActionKind } from "@/lib/intelligence/actionKind";

type StepState = "done" | "current" | "upcoming" | "failed" | "skipped";

interface Step {
  key: string;
  label: string;
  state: StepState;
}

/**
 * Représentation visuelle de la MACHINE D'ÉTAT réelle de la décision
 * (`DecisionPhase`, dérivée de `ActionItem.status` + `resultJson.kind`) —
 * jamais un état inventé pour l'affichage. Cinq étapes :
 * Signal → Scénario → Validation humaine → Action → Résultat.
 * Pour une MISSION MANUELLE (type SAFE), l'étape de validation n'existe pas
 * dans le moteur : elle est affichée comme « Prise en charge » (pas de
 * mutation Shopify, aucune confirmation séparée).
 */
export function stepsForPhase(phase: DecisionPhase, kind: ActionKind): Step[] {
  const validationLabel = kind === "automated_mutation" ? "Validation humaine" : "Prise en charge";
  const actionLabel = kind === "automated_mutation" ? "Action Shopify" : "Mission";
  const base: Array<[string, string]> = [
    ["signal", "Signal"],
    ["scenario", "Scénario"],
    ["validation", validationLabel],
    ["action", actionLabel],
    ["result", "Résultat"],
  ];
  const currentIndex: Record<DecisionPhase, number> = {
    signal: 1,
    confirm: 2,
    "ready-execute": 3,
    "done-success": 4,
    "done-failed": 4,
    stale: 4,
  };
  const idx = currentIndex[phase];
  return base.map(([key, label], i) => {
    let state: StepState = i < idx ? "done" : i === idx ? "current" : "upcoming";
    if (phase === "done-success" && key === "result") state = "done";
    if ((phase === "done-failed" || phase === "stale") && key === "action") state = "failed";
    if ((phase === "done-failed" || phase === "stale") && key === "result") state = "current";
    return { key, label, state };
  });
}

export default function DecisionStepper({ phase, kind }: { phase: DecisionPhase; kind: ActionKind }) {
  const steps = stepsForPhase(phase, kind);
  const current = steps.find((s) => s.state === "current") ?? steps[steps.length - 1]!;
  return (
    <ol className="decision-stepper" aria-label={`Progression de la décision — étape en cours : ${current.label}`}>
      {steps.map((s, i) => (
        <li key={s.key} className={`stepper-step is-${s.state}`} aria-current={s.state === "current" ? "step" : undefined}>
          <span className="stepper-index" aria-hidden="true">
            {s.state === "done" ? <Check size={11} strokeWidth={3} /> : s.state === "failed" ? <AlertTriangle size={11} strokeWidth={2.5} /> : i + 1}
          </span>
          <span className="stepper-label">{s.label}</span>
        </li>
      ))}
    </ol>
  );
}
