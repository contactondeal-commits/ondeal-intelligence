export default function MetricCard({
  label,
  value,
  available,
  hint,
}: {
  label: string;
  value: string | null;
  available?: boolean;
  hint?: string;
}) {
  const isAvailable = available ?? value !== null;
  return (
    <div className="card">
      <div className="metric-label">{label}</div>
      {isAvailable ? (
        <div className="metric-value">{value}</div>
      ) : (
        <div className="metric-value unavailable">Non disponible / connexion nécessaire</div>
      )}
      {hint && <div className="unavailable-note" style={{ marginTop: 4 }}>{hint}</div>}
    </div>
  );
}
