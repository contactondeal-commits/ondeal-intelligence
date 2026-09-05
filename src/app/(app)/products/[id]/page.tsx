import Link from "next/link";
import { requireStore } from "@/lib/store-context";
import { prisma } from "@/lib/db";
import AppShell from "@/components/AppShell";
import MetricCard from "@/components/MetricCard";
import BackButton from "@/components/BackButton";
import DataTag from "@/components/ui/DataTag";
import { SEVERITY_META } from "@/components/ui/severity";
import { notFound } from "next/navigation";
import { hasFeature } from "@/lib/plan-limits";
import { analyzeMargin, MARGIN_THRESHOLDS } from "@/lib/intelligence/margin";
import { resolveCostInputs, supplierCostSourceLabel } from "@/lib/intelligence/costs";
import { WHAT_CHANGED_WINDOWS, parseWhatChangedWindow, type WhatChangedWindow } from "@/lib/intelligence/whatChanged";
import { aggregateProductSalesWindow, computeProductSalesTrend, type ProductSalesRow } from "@/lib/intelligence/productSales";

// CORRECTIF 05/09/2026 — de brèves explications sous "Marge"/"Santé du
// stock" quand non disponibles : sans ça, l'utilisateur ne peut pas savoir
// QUOI faire pour débloquer le facteur (voir diagnostic session du jour).
// Clé = label affiché tel quel dans le ScoreSnapshot (score.ts, FACTORS).
const UNAVAILABLE_HINTS: Record<string, string> = {
  "Marge": "Coût produit manquant — renseignez-le sur la fiche variante (lien ci-dessous) ou via \"Cost per item\" dans Shopify.",
  "Santé du stock": "Pas encore assez d'historique de ventes récentes synchronisé pour ce produit — se met à jour à la prochaine synchronisation.",
  "Évolution des ventes": "Facteur pas encore disponible dans cette version d'OnDeal.",
};

const WINDOW_LABEL: Record<WhatChangedWindow, string> = { 7: "7 jours", 30: "30 jours", 90: "90 jours" };

function eur(v: number | null): string {
  return v === null ? "—" : `${v.toFixed(2)} €`;
}
function pct(v: number | null): string {
  return v === null ? "—" : `${(v * 100).toFixed(1)} %`;
}

/**
 * Fiche Product Intelligence (lot 9, 05/09/2026) — cette page existait déjà
 * (score, stock/variantes, avis, recommandations) mais n'affichait ni marge
 * ni tendance de ventes, et renvoyait les recommandations vers la recherche
 * texte générique de /intelligence au lieu de leur Decision Workspace dédiée
 * (lot 7). Complète ces trois écarts SANS dupliquer de logique : marge via
 * les mêmes `resolveCostInputs`/`analyzeMargin` que /pricing, tendance de
 * ventes via le nouveau `productSales.ts` (même fenêtre 7/30/90j que le
 * Dashboard, sur `SalesSnapshot` déjà reconstruit à chaque synchronisation),
 * liens de décision via le même calcul que le Dashboard (prix → fiche
 * variante, tout le reste → Decision Workspace générique).
 */
export default async function ProductDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ store?: string; window?: string }>;
}) {
  const store = await requireStore(await searchParams);
  const { id } = await params;
  const sp = await searchParams;
  const windowDays = parseWhatChangedWindow(sp.window);

  const product = await prisma.product.findUnique({
    where: { id },
    include: {
      variants: true,
      reviews: { orderBy: { publishedAt: "desc" }, take: 10 },
      costAssumption: true,
      scoreSnapshots: { orderBy: { computedAt: "desc" }, take: 1 },
      recommendations: { where: { status: "OPEN" }, orderBy: { createdAt: "desc" } },
    },
  });
  if (!product || product.storeId !== store.id) notFound();

  const scoreBreakdown = product.scoreSnapshots[0] ? (JSON.parse(product.scoreSnapshots[0].factorsJson) as {
    score: number;
    dataCompleteness: number;
    factors: Array<{ label: string; contribution: number; available: boolean; normalizedValue: number | null }>;
  }) : null;

  const avgRating = product.reviews.length > 0 ? product.reviews.reduce((s, r) => s + r.rating, 0) / product.reviews.length : null;
  const totalStock = product.variants.reduce((s, v) => s + (v.inventoryQuantity ?? 0), 0);
  const anyStockKnown = product.variants.some((v) => v.inventoryQuantity !== null);

  // MARGE PAR VARIANTE — réservé aux plans incluant "pricing" (même
  // gating que /pricing), jamais affiché gratuitement à un plan qui n'y a
  // pas droit. Réutilise exactement resolveCostInputs/analyzeMargin : même
  // formule, même source de coût, jamais une seconde définition de la marge.
  const canSeeMargin = hasFeature(store.plan, "pricing");
  const storeCostDefaults = canSeeMargin
    ? await prisma.store.findUnique({ where: { id: store.id }, select: { defaultShippingCost: true, defaultPaymentFeesRate: true } })
    : null;
  const marginByVariant = canSeeMargin
    ? new Map(
        product.variants.map((v) => {
          const costs = resolveCostInputs(v, product.costAssumption, storeCostDefaults);
          const analysis = analyzeMargin({
            productId: product.id,
            variantId: v.id,
            title: v.title,
            sellingPrice: v.price,
            supplierCost: costs.supplierCost,
            shippingCost: costs.shippingCost,
            paymentFeesRate: costs.paymentFeesRate,
            otherFixedCost: costs.otherFixedCost,
            supplierCostSource: costs.supplierCostSource,
          });
          return [v.id, { analysis, costs }];
        }),
      )
    : null;

  // TENDANCE DE VENTES — fenêtre courante vs fenêtre précédente de même
  // durée, sur les VRAIES SalesSnapshot de ce seul produit (jamais une
  // moyenne boutique). Seuil anti-bruit dans productSales.ts.
  const since = new Date(Date.now() - windowDays * 2 * 24 * 60 * 60 * 1000);
  const salesSnapshots = await prisma.salesSnapshot.findMany({
    where: { productId: product.id, date: { gte: since } },
    select: { date: true, unitsSold: true, revenue: true },
  });
  const salesRows: ProductSalesRow[] = salesSnapshots;
  const now = new Date();
  const currentStart = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);
  const previousStart = new Date(now.getTime() - windowDays * 2 * 24 * 60 * 60 * 1000);
  const currentWindow = aggregateProductSalesWindow(salesRows, currentStart, now);
  const previousWindow = aggregateProductSalesWindow(salesRows, previousStart, currentStart);
  const salesTrend = computeProductSalesTrend(currentWindow, previousWindow, windowDays);

  return (
    <AppShell store={store} active="/products">
      <div className="topbar">
        <div>
          <BackButton fallbackHref={`/products?store=${store.id}`} label="Retour aux produits" />
          <h1 className="page-title">{product.title}</h1>
          <p className="page-subtitle">{product.productType ?? "Catégorie non renseignée"} · statut Shopify : {product.status}</p>
        </div>
      </div>

      <div className="grid grid-3" style={{ marginBottom: 20 }}>
        <MetricCard label="OnDeal Score" value={scoreBreakdown ? `${scoreBreakdown.score}/100 (${scoreBreakdown.dataCompleteness}% de données disponibles)` : null} />
        <MetricCard label="Stock total" value={anyStockKnown ? String(totalStock) : null} />
        <MetricCard label="Note moyenne" value={avgRating !== null ? `${avgRating.toFixed(1)}/5 (${product.reviews.length} avis)` : null} />
      </div>

      {/* Ventes (lot 9, 05/09/2026) — même sélecteur de fenêtre que le
          Dashboard (liens simples, aucun JS client), mais sur les ventes
          réelles de CE seul produit (SalesSnapshot), jamais une moyenne
          boutique. */}
      <div className="filter-tabs" role="group" aria-label="Comparer sur">
        <span className="cell-sub" style={{ padding: "0 4px", alignSelf: "center" }}>
          Comparer sur
        </span>
        {WHAT_CHANGED_WINDOWS.map((w) => (
          <a key={w} href={`?store=${store.id}&window=${w}`} className={`filter-tab ${windowDays === w ? "active" : ""}`}>
            {WINDOW_LABEL[w]}
          </a>
        ))}
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 4 }}>Ventes</h2>
        <p className="cc-card-hint" style={{ marginBottom: 12 }}>
          {WINDOW_LABEL[windowDays]} · commandes non annulées, remboursements non déduits
        </p>
        <div className="grid grid-2">
          <div>
            <div className="metric-label">Unités vendues</div>
            <div className="metric-value">
              {currentWindow.unitsSold.toLocaleString("fr-FR")}
              {salesTrend.label && (
                <span className={`health-trend ${salesTrend.deltaUnitsPct! > 0 ? "is-up" : salesTrend.deltaUnitsPct! < 0 ? "is-down" : ""}`} style={{ marginLeft: 8, fontSize: 13 }}>
                  {salesTrend.deltaUnitsPct! > 0 ? "▲" : salesTrend.deltaUnitsPct! < 0 ? "▼" : "→"} {salesTrend.label}
                </span>
              )}
            </div>
            {!salesTrend.label && (
              <div className="unavailable-note" style={{ marginTop: 4 }}>
                Historique insuffisant sur la période précédente pour afficher une évolution fiable.
              </div>
            )}
          </div>
          <div>
            <div className="metric-label">CA réel</div>
            <div className="metric-value">
              {eur(currentWindow.revenue)}
              {salesTrend.deltaRevenuePct !== null && (
                <span className={`health-trend ${salesTrend.deltaRevenuePct > 0 ? "is-up" : salesTrend.deltaRevenuePct < 0 ? "is-down" : ""}`} style={{ marginLeft: 8, fontSize: 13 }}>
                  {salesTrend.deltaRevenuePct > 0 ? "▲" : salesTrend.deltaRevenuePct < 0 ? "▼" : "→"} {salesTrend.deltaRevenuePct >= 0 ? "+" : ""}
                  {salesTrend.deltaRevenuePct.toFixed(0)} %
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {scoreBreakdown && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 12 }}>Détail du score — pourquoi ce chiffre ?</h2>
          <table className="table">
            <thead>
              <tr><th>Facteur</th><th>Disponible</th><th>Contribution</th></tr>
            </thead>
            <tbody>
              {scoreBreakdown.factors.map((f, i) => (
                <tr key={i}>
                  <td>{f.label}</td>
                  <td>
                    {f.available ? (
                      "Oui"
                    ) : (
                      <span className="unavailable-note">
                        Non disponible
                        {UNAVAILABLE_HINTS[f.label] && ` — ${UNAVAILABLE_HINTS[f.label]}`}
                      </span>
                    )}
                  </td>
                  <td>{f.contribution.toFixed(1)} pts</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 12 }}>Variantes & stock</h2>
        {!canSeeMargin && (
          <p className="unavailable-note" style={{ marginBottom: 12 }}>
            Coût fournisseur et marge disponibles avec le plan Pro et supérieur.
          </p>
        )}
        <table className="table">
          <thead>
            <tr>
              <th>Variante</th><th>SKU</th><th>Prix</th>
              {canSeeMargin && (
                <>
                  <th>Coût fournisseur</th>
                  <th>Marge brute</th>
                </>
              )}
              <th>Stock boutique</th><th>Stock fournisseur</th><th></th>
            </tr>
          </thead>
          <tbody>
            {product.variants.map((v) => {
              const margin = marginByVariant?.get(v.id);
              return (
                <tr key={v.id}>
                  <td>{v.title}</td>
                  <td>{v.sku ?? "—"}</td>
                  <td>{v.price !== null ? `${v.price.toFixed(2)} €` : <span className="unavailable-note">n/d</span>}</td>
                  {canSeeMargin && (
                    <>
                      <td>
                        {margin && margin.analysis.supplierCost !== null ? (
                          <>
                            {eur(margin.analysis.supplierCost)} <DataTag status={margin.analysis.status.supplierCost} compact />
                            <div className="cell-sub">{supplierCostSourceLabel(margin.costs.supplierCostSource)}</div>
                          </>
                        ) : (
                          <span className="unavailable-note">n/d</span>
                        )}
                      </td>
                      <td className={margin?.analysis.grossMargin !== null && margin!.analysis.grossMargin! < 0 ? "is-negative" : margin?.analysis.grossMarginRate !== null && margin!.analysis.grossMarginRate! < MARGIN_THRESHOLDS.faibleRate ? "is-low" : ""}>
                        {margin && margin.analysis.grossMargin !== null ? (
                          <>
                            {eur(margin.analysis.grossMargin)} <span className="cell-sub">({pct(margin.analysis.grossMarginRate)})</span>{" "}
                            <DataTag status={margin.analysis.status.grossMargin} compact />
                          </>
                        ) : (
                          <span className="unavailable-note">n/d</span>
                        )}
                      </td>
                    </>
                  )}
                  <td>{v.inventoryQuantity ?? <span className="unavailable-note">n/d</span>}</td>
                  <td>{v.supplierStock ?? <span className="unavailable-note">n/d</span>}</td>
                  <td>
                    <Link href={`/pricing/${v.id}?store=${store.id}`} className="btn btn-ghost btn-sm">
                      Prix &amp; coûts
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {product.recommendations.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 12 }}>Recommandations pour ce produit</h2>
          {product.recommendations.map((r) => {
            const meta = SEVERITY_META[r.severity as keyof typeof SEVERITY_META] ?? SEVERITY_META.SUGGESTION;
            // Même calcul que le Dashboard (lot 7/9) : le prix a sa fiche
            // variante dédiée, plus riche (simulateur, coûts, marge) — tout
            // le reste va vers le Decision Workspace générique, jamais vers
            // le repli fragile par recherche texte de /intelligence.
            const payload = r.actionPayloadJson ? (JSON.parse(r.actionPayloadJson) as { variantId?: string }) : null;
            const decisionHref =
              r.actionType === "update_price" && payload?.variantId
                ? `/pricing/${payload.variantId}?store=${store.id}`
                : `/decisions/${r.id}?store=${store.id}`;
            return (
              <div key={r.id} style={{ padding: "10px 0", borderBottom: "1px solid var(--color-border)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <span className={`badge badge-${meta.cls}`}>{meta.label}</span>
                  <span style={{ fontWeight: 700 }}>{r.title}</span>
                </div>
                <div style={{ fontSize: 13.5, color: "#6b6b85" }}>{r.reason}</div>
                <Link href={decisionHref} className="cell-sub" style={{ display: "inline-block", marginTop: 4 }}>
                  Voir la décision →
                </Link>
              </div>
            );
          })}
        </div>
      )}

      <div className="card">
        <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 12 }}>Derniers avis réels</h2>
        {product.reviews.length === 0 ? (
          <p className="unavailable-note">Aucun avis pour ce produit.</p>
        ) : (
          product.reviews.map((r) => (
            <div key={r.id} style={{ padding: "10px 0", borderBottom: "1px solid var(--color-border)" }}>
              <div style={{ fontWeight: 700 }}>{"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)} {r.title ?? ""}</div>
              <div style={{ fontSize: 13.5, color: "#6b6b85" }}>{r.body}</div>
              <div style={{ fontSize: 12, color: "#9a9ab0", marginTop: 4 }}>
                {r.authorName ?? "Anonyme"} — {r.publishedAt.toLocaleDateString("fr-FR")}
                {r.verifiedPurchase ? " — Achat vérifié" : ""}
              </div>
            </div>
          ))
        )}
      </div>
    </AppShell>
  );
}
