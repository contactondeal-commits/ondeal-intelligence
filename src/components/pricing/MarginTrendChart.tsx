import Link from "next/link";
import DataTag from "@/components/ui/DataTag";

export type MarginTrendPoint = {
  date: Date;
  revenue: number;
  margin: number | null;
  marginRate: number | null;
  costCoverage: number;
};

const WINDOWS = [
  { label: "7 j", value: 7 },
  { label: "30 j", value: 30 },
  { label: "90 j", value: 90 },
];

function eur(v: number): string {
  return `${v.toFixed(0)} €`;
}
function pct(v: number): string {
  return `${(v * 100).toFixed(1)} %`;
}
function coverageBadgeClass(coverage: number): string {
  if (coverage >= 0.8) return "badge-suggestion";
  if (coverage >= 0.5) return "badge-opportunity";
  return "badge-urgent";
}

/**
 * Tendance de marge (MarginSnapshot) — même style que le SalesChart du
 * Dashboard (SVG fait main, pas de librairie externe) pour rester cohérent
 * avec le reste de l'app. `marginRate` n'est représenté QUE sur la part du
 * CA à coût connu (voir rebuildMarginSnapshots) : le badge de couverture au-
 * dessus du graphique rend cette limite visible plutôt que de laisser croire
 * à un taux de marge sur 100 % du CA.
 */
export default function MarginTrendChart({
  points,
  days,
  urlParams,
}: {
  points: MarginTrendPoint[];
  days: number;
  urlParams: Record<string, string | undefined>;
}) {
  const withRate = points.filter((p) => p.marginRate !== null);
  const avgCoverage = points.length > 0 ? points.reduce((s, p) => s + p.costCoverage, 0) / points.length : null;

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="cc-card-head">
        <div>
          <h2 className="cc-card-title">Tendance de marge</h2>
          <span className="cc-card-hint">CA réel journalier (barres) et taux de marge complet (courbe) — commandes non annulées, remboursements non déduits</span>
        </div>
        <div className="segment-tabs" style={{ marginBottom: 0, borderBottom: "none" }} role="tablist" aria-label="Période">
          {WINDOWS.map((w) => (
            <Link
              key={w.value}
              href={withParams(urlParams, w.value)}
              className={`segment-tab${days === w.value ? " is-active" : ""}`}
              role="tab"
              aria-selected={days === w.value}
            >
              {w.label}
            </Link>
          ))}
        </div>
      </div>

      {avgCoverage !== null && points.length > 0 && (
        <div className="signal-cell" style={{ marginTop: 4, marginBottom: 10 }}>
          <span className={`badge ${coverageBadgeClass(avgCoverage)}`}>{Math.round(avgCoverage * 100)}% du CA à coût connu</span>
          <DataTag status="calculated" compact />
          <span className="cell-sub">Le taux de marge ci-dessous ne porte que sur cette part du CA — le reste n&apos;a pas de coût renseigné.</span>
        </div>
      )}

      {points.length === 0 ? (
        <div className="chart-empty">
          <DataTag status="unavailable" compact /> Aucune vente enregistrée sur cette période — la courbe apparaîtra avec les premières commandes.
        </div>
      ) : (
        <TrendSvg points={points} />
      )}

      {points.length > 0 && withRate.length === 0 && (
        <p className="cell-sub" style={{ marginTop: 8 }}>
          Coût inconnu sur toutes les ventes de la période : le taux de marge ne peut pas être tracé. Renseignez le coût fournisseur (Shopify) ou une
          hypothèse de coût pour débloquer ce point.
        </p>
      )}
    </div>
  );
}

function withParams(params: Record<string, string | undefined>, days: number): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") usp.set(k, v);
  }
  usp.set("days", String(days));
  return `?${usp.toString()}`;
}

function TrendSvg({ points }: { points: MarginTrendPoint[] }) {
  const w = 720;
  const h = 180;
  const pad = { l: 44, r: 44, t: 10, b: 24 };
  const maxRevenue = Math.max(...points.map((p) => p.revenue), 1);
  const rates = points.map((p) => p.marginRate).filter((r): r is number => r !== null);
  const maxAbsRate = Math.max(...rates.map((r) => Math.abs(r)), 0.1);
  // Axe du taux centré sur 0 pour que les marges négatives se voient sous la ligne médiane.
  const rateMin = -maxAbsRate;
  const rateMax = maxAbsRate;
  const bw = (w - pad.l - pad.r) / points.length;

  const yRevenue = (v: number) => pad.t + (h - pad.t - pad.b) * (1 - v / maxRevenue);
  const yRate = (v: number) => pad.t + (h - pad.t - pad.b) * (1 - (v - rateMin) / (rateMax - rateMin));
  const xCenter = (i: number) => pad.l + i * bw + bw / 2;

  // La courbe casse (pas de segment) partout où marginRate est null — jamais
  // interpolée à travers un jour sans coût connu.
  const segments: Array<Array<{ x: number; y: number; p: MarginTrendPoint }>> = [];
  let current: Array<{ x: number; y: number; p: MarginTrendPoint }> = [];
  points.forEach((p, i) => {
    if (p.marginRate === null) {
      if (current.length > 0) segments.push(current);
      current = [];
      return;
    }
    current.push({ x: xCenter(i), y: yRate(p.marginRate), p });
  });
  if (current.length > 0) segments.push(current);

  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`CA et taux de marge journaliers sur ${points.length} jours avec vente`}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={pad.l} x2={w - pad.r} y1={yRevenue(maxRevenue * f)} y2={yRevenue(maxRevenue * f)} className="chart-grid" />
            <text x={pad.l - 6} y={yRevenue(maxRevenue * f) + 4} className="chart-axis" textAnchor="end">
              {Math.round(maxRevenue * f)}
            </text>
          </g>
        ))}
        <text x={w - pad.r + 6} y={yRate(rateMax) + 4} className="chart-axis">
          {Math.round(rateMax * 100)}%
        </text>
        <line x1={pad.l} x2={w - pad.r} y1={yRate(0)} y2={yRate(0)} className="chart-grid chart-grid-zero" />
        <text x={w - pad.r + 6} y={yRate(0) + 4} className="chart-axis">
          0%
        </text>
        <text x={w - pad.r + 6} y={yRate(rateMin) + 4} className="chart-axis">
          {Math.round(rateMin * 100)}%
        </text>

        {points.map((p, i) => (
          <rect key={i} x={pad.l + i * bw + 1} y={yRevenue(p.revenue)} width={Math.max(2, bw - 2)} height={h - pad.b - yRevenue(p.revenue)} className="chart-bar-muted">
            <title>
              {p.date.toLocaleDateString("fr-FR")} : {eur(p.revenue)} de CA{p.marginRate !== null ? `, marge ${pct(p.marginRate)} (${Math.round(p.costCoverage * 100)}% du CA à coût connu)` : ", coût inconnu"}
            </title>
          </rect>
        ))}

        {segments.map((seg, si) => (
          <g key={si}>
            <polyline points={seg.map((pt) => `${pt.x},${pt.y}`).join(" ")} className="chart-line" fill="none" />
            {seg.map((pt, pi) => (
              <circle key={pi} cx={pt.x} cy={pt.y} r={2.5} className="chart-line-dot">
                <title>
                  {pt.p.date.toLocaleDateString("fr-FR")} : marge {pct(pt.p.marginRate as number)}
                </title>
              </circle>
            ))}
          </g>
        ))}

        <text x={pad.l} y={h - 6} className="chart-axis">
          {points[0]!.date.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}
        </text>
        <text x={w - pad.r} y={h - 6} className="chart-axis" textAnchor="end">
          {points[points.length - 1]!.date.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}
        </text>
      </svg>
      <figcaption className="cell-sub">
        Barres = CA réel (échelle gauche, €). Courbe = taux de marge complet (échelle droite, %) — interrompue les jours sans coût connu.
      </figcaption>
    </figure>
  );
}
