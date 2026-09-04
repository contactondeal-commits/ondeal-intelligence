import type { DataStatus } from "@/types";

const META: Record<DataStatus, { label: string; title: string }> = {
  real: { label: "Réel", title: "Donnée lue telle quelle dans Shopify" },
  calculated: { label: "Calculé", title: "Valeur dérivée par OnDeal à partir de données réelles (et d'hypothèses si indiqué)" },
  estimated: { label: "Estimé", title: "Hypothèse saisie dans OnDeal — pas une donnée Shopify" },
  unavailable: { label: "Indisponible", title: "Ne peut pas être calculé honnêtement avec les données actuelles" },
};

/**
 * Étiquette de fiabilité — la séparation REAL / CALCULATED / ESTIMATED /
 * UNAVAILABLE est visible partout où un chiffre est affiché, jamais
 * implicite.
 */
export default function DataTag({ status, compact = false }: { status: DataStatus; compact?: boolean }) {
  const m = META[status];
  return (
    <span className={`data-tag data-tag-${status}${compact ? " data-tag-compact" : ""}`} title={m.title}>
      {m.label}
    </span>
  );
}
