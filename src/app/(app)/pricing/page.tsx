import Link from "next/link";
import { requireStore } from "@/lib/store-context";
import { prisma } from "@/lib/db";
import AppShell from "@/components/AppShell";
import FeatureUnavailable from "@/components/FeatureUnavailable";
import { hasFeature } from "@/lib/plan-limits";
import DataTag from "@/components/ui/DataTag";
import Pagination from "@/components/ui/Pagination";
import TableControls from "@/components/ui/TableControls";
import StoreCostDefaultsForm from "@/components/pricing/StoreCostDefaultsForm";
import MarginTrendChart from "@/components/pricing/MarginTrendChart";
import CostAssumptionsBanner from "@/components/pricing/CostAssumptionsBanner";
import { parsePageParams } from "@/lib/pagination";
import { queryPricingRows, pricingSummary, type CostFilter, type MarginFilter, type PricingSort } from "@/lib/pricing/query";
import { MARGIN_THRESHOLDS } from "@/lib/intelligence/margin";
import { supplierCostSourceLabel } from "@/lib/intelligence/costs";

type Params = { store?: string; q?: string; cost?: string; margin?: string; sort?: string; page?: string; pageSize?: string; days?: string };
const TREND_WINDOWS = [7, 30, 90];

const COST_OPTIONS: Array<{ value: CostFilter; label: string }> = [
  { value: "all", label: "Toutes les sources" },
  { value: "real", label: "Coût réel Shopify" },
  { value: "fallback", label: "Hypothèse OnDeal (repli)" },
  { value: "none", label: "Sans coût" },
];
const MARGIN_OPTIONS: Array<{ value: MarginFilter; label: string }> = [
  { value: "all", label: "Toutes les marges brutes" },
  { value: "negative", label: "Marge brute négative" },
  { value: "low", label: `Marge brute faible (< ${MARGIN_THRESHOLDS.faibleRate * 100}%)` },
  { value: "mid", label: `Intermédiaire (${MARGIN_THRESHOLDS.faibleRate * 100}–${MARGIN_THRESHOLDS.fortRate * 100}%)` },
  { value: "high", label: `Forte (≥ ${MARGIN_THRESHOLDS.fortRate * 100}%)` },
  { value: "unavailable", label: "Non calculable" },
];
const SORT_OPTIONS: Array<{ value: PricingSort; label: string }> = [
  { value: "gross_asc", label: "Marge brute croissante" },
  { value: "gross_desc", label: "Marge brute décroissante" },
  { value: "price_asc", label: "Prix croissant" },
  { value: "price_desc", label: "Prix décroissant" },
  { value: "stock_asc", label: "Stock croissant" },
  { value: "title", label: "Nom du produit" },
];

const PHASE_LABEL: Record<string, string> = {
  signal: "Signal",
  confirm: "À valider",
  "ready-execute": "Prête",
  "done-success": "Exécutée",
  "done-failed": "Échec",
  stale: "Obsolète",
};
const PHASE_TONE: Record<string, string> = { signal: "neutral", confirm: "warning", "ready-execute": "info", "done-success": "success", "done-failed": "danger", stale: "danger" };

function pick<T extends string>(value: string | undefined, allowed: T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function eur(v: number | null): string {
  return v === null ? "—" : `${v.toFixed(2)} €`;
}
function pct(v: number | null): string {
  return v === null ? "—" : `${(v * 100).toFixed(1)} %`;
}

/**
 * PRIX & MARGE — table compacte, paginée par la base (jamais le catalogue
 * entier dans une page), avec la séparation REAL / CALCULATED / ESTIMATED /
 * UNAVAILABLE visible sur chaque colonne. Chaque ligne donne accès au
 * Decision Workspace de la variante (simulation puis, si un signal existe,
 * décision).
 */
export default async function PricingPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const store = await requireStore(params);
  if (!hasFeature(store.plan, "pricing")) {
    return (
      <AppShell store={store} active="/pricing">
        <FeatureUnavailable feature="Prix & Marge" plan={store.plan} storeId={store.id} />
      </AppShell>
    );
  }
  const { page, pageSize } = parsePageParams(params);
  const cost = pick(params.cost, COST_OPTIONS.map((o) => o.value), "all");
  const margin = pick(params.margin, MARGIN_OPTIONS.map((o) => o.value), "all");
  const sort = pick(params.sort, SORT_OPTIONS.map((o) => o.value), "gross_asc");
  const days = TREND_WINDOWS.includes(Number(params.days)) ? Number(params.days) : 30;
  const trendSince = new Date();
  trendSince.setUTCDate(trendSince.getUTCDate() - days);
  trendSince.setUTCHours(0, 0, 0, 0);

  const [summary, { rows, total }, storeDefaults, marginSnapshots] = await Promise.all([
    pricingSummary(store.id),
    queryPricingRows(store.id, { q: params.q, cost, margin, sort, page, pageSize }),
    prisma.store.findUnique({ where: { id: store.id }, select: { defaultShippingCost: true, defaultPaymentFeesRate: true } }),
    prisma.marginSnapshot.findMany({
      where: { storeId: store.id, date: { gte: trendSince } },
      orderBy: { date: "asc" },
      select: { date: true, revenue: true, margin: true, marginRate: true, costCoverage: true },
    }),
  ]);

  const urlParams: Record<string, string | undefined> = { store: store.id, q: params.q, cost, margin, sort, pageSize: params.pageSize };
  const assumptionsSet = storeDefaults?.defaultShippingCost !== null && storeDefaults?.defaultPaymentFeesRate !== null;

  return (
    <AppShell store={store} active="/pricing">
      <div className="topbar">
        <div>
          <h1 className="page-title">Prix & Marge</h1>
          <p className="page-subtitle">
            Coût réel Shopify prioritaire, hypothèses OnDeal en repli explicite. Marge brute = prix − coût fournisseur ; marge complète =
            marge brute − transport − frais de paiement (hypothèses).
          </p>
        </div>
        <div className="data-legend" aria-label="Légende des étiquettes de fiabilité">
          <DataTag status="real" /> <DataTag status="calculated" /> <DataTag status="estimated" /> <DataTag status="unavailable" />
        </div>
      </div>

      {!assumptionsSet && <CostAssumptionsBanner storeId={store.id} />}

      <div className="stat-strip" role="list">
        <StatTile label="Variantes" value={summary.variants.toLocaleString("fr-FR")} tag="real" />
        <StatTile label="Coût réel Shopify" value={summary.withRealCost.toLocaleString("fr-FR")} tag="real" hint={`${summary.withFallbackCost} en repli, ${summary.withoutCost} sans coût`} />
        <StatTile label="Marge brute négative" value={summary.grossNegative.toLocaleString("fr-FR")} tag="calculated" tone={summary.grossNegative > 0 ? "danger" : undefined} />
        <StatTile label={`Marge brute < ${MARGIN_THRESHOLDS.faibleRate * 100} %`} value={summary.grossLow.toLocaleString("fr-FR")} tag="calculated" tone={summary.grossLow > 0 ? "warning" : undefined} />
        <StatTile
          label="Marge complète calculable"
          value={summary.fullMarginComputable.toLocaleString("fr-FR")}
          tag={summary.fullMarginComputable > 0 ? "estimated" : "unavailable"}
          hint={assumptionsSet ? "Avec les hypothèses boutique" : "Renseignez les hypothèses boutique"}
        />
      </div>

      <MarginTrendChart
        points={marginSnapshots.map((s) => ({ date: s.date, revenue: s.revenue, margin: s.margin, marginRate: s.marginRate, costCoverage: s.costCoverage }))}
        days={days}
        urlParams={urlParams}
      />

      <div className="card" style={{ marginBottom: 16 }} id="store-cost-defaults">
        <StoreCostDefaultsForm
          storeId={store.id}
          defaultShippingCost={storeDefaults?.defaultShippingCost ?? null}
          defaultPaymentFeesRate={storeDefaults?.defaultPaymentFeesRate ?? null}
        />
      </div>

      <div className="card card-table">
        <TableControls
          params={urlParams}
          searchPlaceholder="Rechercher un produit, une variante, un SKU"
          filters={[
            { key: "cost", label: "Coût", value: cost, options: COST_OPTIONS },
            { key: "margin", label: "Marge brute", value: margin, options: MARGIN_OPTIONS },
          ]}
          sort={{ key: "sort", label: "Tri", value: sort, options: SORT_OPTIONS }}
        />

        <div className="table-scroll">
          <table className="table table-compact">
            <thead>
              <tr>
                <th>Produit / variante</th>
                <th className="num">
                  Prix <DataTag status="real" compact />
                </th>
                <th className="num">Coût</th>
                <th className="num">
                  Marge brute <DataTag status="calculated" compact />
                </th>
                <th className="num">Marge complète</th>
                <th>Opportunité</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="unavailable-note" style={{ padding: 24, textAlign: "center" }}>
                    Aucune variante ne correspond à ces critères.
                  </td>
                </tr>
              )}
              {rows.map((r) => {
                const a = r.analysis;
                const grossTone = a.grossMarginRate === null ? "" : a.grossMarginRate < 0 ? "is-negative" : a.grossMarginRate < MARGIN_THRESHOLDS.faibleRate ? "is-low" : "";
                return (
                  <tr key={r.variantId}>
                    <td>
                      <div className="cell-title">{r.productTitle}</div>
                      <div className="cell-sub cell-sub-clip" title={r.sku ? `SKU ${r.sku}` : undefined}>
                        {r.variantCount > 1 ? `${r.variantTitle} · ` : ""}
                        stock {r.inventoryQuantity ?? "n/d"}
                        {r.sku ? ` · SKU ${r.sku}` : ""}
                      </div>
                    </td>
                    <td className="num">{eur(a.sellingPrice)}</td>
                    <td className="num" title={supplierCostSourceLabel(a.supplierCostSource)}>
                      {eur(a.supplierCost)} <DataTag status={a.status.supplierCost} compact />
                    </td>
                    <td className={`num ${grossTone}`}>
                      {eur(a.grossMargin)} <span className="cell-sub">({pct(a.grossMarginRate)})</span>
                    </td>
                    <td className="num">
                      {a.margin !== null ? (
                        <span className={a.margin < 0 ? "is-negative" : ""} title={`Hypothèses : transport ${eur(a.shippingCost)}, frais ${pct(a.paymentFees !== null && a.sellingPrice ? a.paymentFees / a.sellingPrice : null)}`}>
                          {eur(a.margin)} <span className="cell-sub">({pct(a.marginRate)})</span> <DataTag status="estimated" compact />
                        </span>
                      ) : (
                        <span className="cell-sub" title={a.supplierCost === null ? "Coût fournisseur manquant" : "Transport et/ou frais de paiement non renseignés"}>
                          <DataTag status="unavailable" compact />
                        </span>
                      )}
                    </td>
                    <td>
                      {r.signal ? (
                        <div className="signal-cell">
                          <span className={`badge ${r.signal.severity === "URGENT" ? "badge-urgent" : r.signal.severity === "OPPORTUNITY" ? "badge-opportunity" : "badge-suggestion"}`}>{r.signal.label}</span>
                          {r.phase && <span className={`phase-pill phase-pill-${PHASE_TONE[r.phase]}`}>{PHASE_LABEL[r.phase]}</span>}
                        </div>
                      ) : (
                        <span className="cell-sub">Aucun signal</span>
                      )}
                    </td>
                    <td>
                      <Link className={`btn btn-sm ${r.openRecommendationId ? "btn-primary" : "btn-secondary"}`} href={`/pricing/${r.variantId}?store=${store.id}`}>
                        {r.openRecommendationId ? (r.phase && r.phase !== "signal" ? "Reprendre" : "Décider") : "Simuler"}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Pagination total={total} page={page} pageSize={pageSize} params={urlParams} label="variantes" />
      </div>
    </AppShell>
  );
}

function StatTile({
  label,
  value,
  tag,
  hint,
  tone,
}: {
  label: string;
  value: string;
  tag: "real" | "calculated" | "estimated" | "unavailable";
  hint?: string;
  tone?: "danger" | "warning";
}) {
  return (
    <div className={`stat-tile${tone ? ` stat-tile-${tone}` : ""}`} role="listitem">
      <div className="stat-tile-label">
        {label} <DataTag status={tag} compact />
      </div>
      <div className="stat-tile-value">{value}</div>
      {hint && <div className="stat-tile-hint">{hint}</div>}
    </div>
  );
}
