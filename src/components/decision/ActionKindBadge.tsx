import { actionKindDescription, actionKindLabel, type ActionKind } from "@/lib/intelligence/actionKind";
import Badge from "@/components/ui/Badge";

/**
 * Distingue toujours une AUTOMATED ACTION (mutation Shopify réelle) d'une
 * MANUAL MISSION (préparée/expliquée par OnDeal, réalisée par l'utilisateur)
 * — jamais de fausse exécution affichée comme si OnDeal avait agi seul.
 */
export default function ActionKindBadge({ kind }: { kind: ActionKind }) {
  return (
    <span title={actionKindDescription(kind)}>
      <Badge tone={kind === "automated_mutation" ? "info" : "neutral"}>{actionKindLabel(kind)}</Badge>
    </span>
  );
}
