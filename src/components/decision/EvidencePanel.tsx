import DataTag from "@/components/ui/DataTag";
import type { DataStatus } from "@/types";

export interface DataPoint {
  label: string;
  value: string;
  /** Fiabilité de la donnée — affichée quand elle est connue (jamais devinée). */
  status?: DataStatus;
}

/**
 * Section ÉTAT ACTUEL & JUSTIFICATION — présente les données réelles qui
 * motivent le signal (avec leur fiabilité) puis la justification textuelle
 * du moteur et l'impact potentiel. Pur affichage, aucun recalcul.
 */
export default function EvidencePanel({
  dataPoints,
  reason,
  impact,
  groupCount,
}: {
  dataPoints: DataPoint[];
  reason: string;
  impact: string;
  groupCount: number;
}) {
  return (
    <div className="decision-section">
      <div className="decision-section-label">État actuel et justification</div>
      {dataPoints.length > 0 && (
        <div className="decision-data-points">
          {dataPoints.map((d) => (
            <div className="decision-data-point" key={d.label}>
              <span className="decision-data-point-label">
                {d.label}
                {d.status && (
                  <>
                    {" "}
                    <DataTag status={d.status} compact />
                  </>
                )}
              </span>
              <span className="decision-data-point-value">{d.value}</span>
            </div>
          ))}
        </div>
      )}
      <p className="decision-reason">
        <span className="decision-reason-label">Pourquoi</span>
        {reason}
        {groupCount > 1 ? ` (exemple sur ${groupCount} au total)` : ""}
      </p>
      <p className="decision-reason">
        <span className="decision-reason-label">Impact potentiel</span>
        {impact}
      </p>
    </div>
  );
}
