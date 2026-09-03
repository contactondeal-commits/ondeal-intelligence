/** Anneau de score SVG — pas de dépendance externe, valeur réelle uniquement. */
export default function HealthRing({ score, size = 128 }: { score: number | null; size?: number }) {
  const stroke = 10;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = score === null ? 0 : Math.max(0, Math.min(100, score)) / 100;
  const offset = circumference * (1 - pct);
  const color = score === null ? "rgba(255,255,255,0.25)" : score >= 70 ? "#22c55e" : score >= 50 ? "#f3a023" : "#f87171";

  return (
    <div className="stat-ring-wrap" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth={stroke} />
        {score !== null && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            style={{ transition: "stroke-dashoffset 600ms cubic-bezier(0.16,1,0.3,1)" }}
          />
        )}
      </svg>
      <div className="stat-ring-value">
        <div className="stat-ring-value-number">{score === null ? "—" : score}</div>
        <div className="stat-ring-value-suffix">{score === null ? "N/D" : "/ 100"}</div>
      </div>
    </div>
  );
}
