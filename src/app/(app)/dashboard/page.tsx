import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { Prisma } from "@prisma/client";
import { requireStore } from "@/lib/store-context";
import { prisma } from "@/lib/db";
import AppShell from "@/components/AppShell";
import DecisionCard from "@/components/DecisionCard";
import SyncButton from "@/components/SyncButton";
import HealthRing from "@/components/HealthRing";
import DataTag from "@/components/ui/DataTag";
import { SEVERITY_META } from "@/components/ui/severity";
import { groupRecommendations, countBySeverity } from "@/lib/intelligence/group";
import { lightenGroup } from "@/lib/intelligence/groupTransport";
import { derivePhaseFromExistingAction } from "@/lib/intelligence/decision";
import { actionKindFor } from "@/lib/intelligence/actionKind";
import { isPricePrediction } from "@/lib/intelligence/prediction";
import {
  WHAT_CHANGED_WINDOWS,
  parseWhatChangedWindow,
  aggregateWindow,
  computeTrend,
  marginRateDeltaPts,
  computeScoreTrend,
  type MarginSnapshotRow,
  type WhatChangedWindow,
} from "@/lib/intelligence/whatChanged";
import type { ScoreBreakdown } from "@/types";

const WINDOW_LABEL: Record<WhatChangedWindow, string> = { 7: "7 jours", 30: "30 jours", 90: "90 jours" };

const PHASE_LABEL: Record<string, { label: string; tone: string }> = {
  confirm: { label: "À valider", tone: "warning" },
  "ready-execute": { label: "Prête", tone: "info" },
  "done-success": { label: "Exécutée", tone: "success" },
  "done-failed": { label: "Échec — à reprendre", tone: "danger" },
  stale: { label: "Obsolète", tone: "danger" },
  signal: { label: "Signal", tone: "neutral" },
};
const TYPE_LABEL: Record<string, string> = {
  update_price: "Prix",
  unpublish_product: "Dépublication",
  review_supplier: "Réassort",
  request_reviews: "Avis",
  promote_product: "Mise en avant",
  edit_product_data: "Fiche produit",
};
const EVENT_LABEL: Record<string, string> = {
  "sync.completed": "Synchronisation",
  "sync.failed": "Synchronisation échouée",
  "intelligence.recomputed": "Analyse recalculée",
  "action.prepared": "Décision préparée",
  "action.confirmed": "Décision validée",
  "action.executed": "Action exécutée",
  "action.failed": "Action échouée",
  "action.conflict_avoided": "Conflit évité",
  "cost_defaults.updated": "Hypothèses mises à jour",
  "integration.connected": "Intégration connectée",
};

function timeAgo(date: Date): string {
  const min = Math.floor((Date.now() - date.getTime()) / 60000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h`;
  return `il y a ${Math.floor(h / 24)} j`;
}
function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Bonjour" : h < 18 ? "Bon après-midi" : "Bonsoir";
}
function eur(v: number | null): string {
  return v === null ? "—" : `${v.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

/**
 * COMMAND CENTER — direction produit 03/09/2026 : santé de la boutique,
 * priorités du jour, brief, performance, opportunités, signaux récents,
 * OnDeal AI, puis la décision prioritaire complète. Chaque bloc n'affiche
 * que des données réelles (ou « indisponible ») ; aucune courbe n'est
 * dessinée sans série réelle.
 */
export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ store?: string; window?: string }> }) {
  const params = await searchParams;
  const store = await requireStore(params);
  const now = Date.now();
  const nowDate = new Date(now);
  const since7d = new Date(now - 7 * 24 * 60 * 60 * 1000);

  // « Qu'est-ce qui a changé » (05/09/2026, lot 6) — une seule fenêtre
  // choisie dans l'URL gouverne à la fois le score de santé et la
  // performance ci-dessous, pour une comparaison cohérente sur toute la
  // page plutôt que des fenêtres différentes par bloc.
  const windowDays = parseWhatChangedWindow(params.window);
  const sinceWindow = new Date(now - windowDays * 24 * 60 * 60 * 1000);
  const sincePrevWindow = new Date(now - 2 * windowDays * 24 * 60 * 60 * 1000);

  const [user, productCount, integrations, lastAnalysis, recommendations, latestScores, historicalScores, stockAgg, marginRows, noReviewCount, actionsRecent, actionCounts, recentEvents] =
    await Promise.all([
      prisma.user.findUnique({ where: { id: store.userId }, select: { name: true } }),
      prisma.product.count({ where: { storeId: store.id } }),
      prisma.integration.findMany({ where: { storeId: store.id } }),
      prisma.auditLog.findFirst({ where: { storeId: store.id, event: "intelligence.recomputed" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
      prisma.recommendation.findMany({
        where: { storeId: store.id, status: "OPEN" },
        include: { product: { select: { id: true, title: true } } },
        orderBy: [{ severity: "asc" }, { confidence: "desc" }],
      }),
      prisma.$queryRaw<Array<{ productId: string; score: number; factorsJson: string }>>(Prisma.sql`
        SELECT s."productId", s.score, s."factorsJson" FROM score_snapshots s
        WHERE s."storeId" = ${store.id}
          AND s."computedAt" = (SELECT MAX(s2."computedAt") FROM score_snapshots s2 WHERE s2."storeId" = ${store.id} AND s2."productId" = s."productId")
      `),
      // Historique de santé (« Qu'est-ce qui a changé », lot 6) : pour
      // chaque produit, son score le plus récent AU PLUS TARD à la date
      // cible (aujourd'hui − windowDays) — jamais le score actuel réutilisé
      // à tort. Un produit sans aucun snapshot avant cette date n'apparaît
      // simplement pas (voir computeScoreTrend, comparaison produit par
      // produit uniquement sur l'intersection des deux dates).
      prisma.$queryRaw<Array<{ productId: string; score: number }>>(Prisma.sql`
        SELECT s."productId", s.score FROM score_snapshots s
        WHERE s."storeId" = ${store.id}
          AND s."computedAt" = (
            SELECT MAX(s2."computedAt") FROM score_snapshots s2
            WHERE s2."storeId" = ${store.id} AND s2."productId" = s."productId" AND s2."computedAt" <= ${sinceWindow}
          )
      `),
      prisma.$queryRaw<Array<{ known: number | bigint; ruptureVariants: number | bigint; ruptureProducts: number | bigint }>>(Prisma.sql`
        SELECT SUM(CASE WHEN v."inventoryQuantity" IS NOT NULL THEN 1 ELSE 0 END) AS known,
               SUM(CASE WHEN v."inventoryQuantity" = 0 THEN 1 ELSE 0 END) AS "ruptureVariants",
               COUNT(DISTINCT CASE WHEN v."inventoryQuantity" = 0 THEN v."productId" END) AS "ruptureProducts"
        FROM variants v JOIN products p ON p.id = v."productId" WHERE p."storeId" = ${store.id}
      `),
      // Performance & « Qu'est-ce qui a changé » (lot 6) : une seule requête
      // couvrant la fenêtre courante ET la fenêtre précédente, sur
      // MarginSnapshot — agrégat quotidien déjà réel (CA, marge sur la part
      // à coût connu, commandes, unités), reconstruit à chaque
      // synchronisation (voir rebuildMarginSnapshots). Remplace les
      // anciennes requêtes Order/OrderLine/SalesSnapshot séparées : une
      // seule source pour le CA, les commandes, les unités, la marge ET le
      // graphique, jamais deux calculs qui pourraient diverger.
      prisma.marginSnapshot.findMany({
        where: { storeId: store.id, date: { gte: sincePrevWindow } },
        select: { date: true, revenue: true, margin: true, costCoverage: true, orderCount: true, unitsSold: true },
        orderBy: { date: "asc" },
      }),
      prisma.product.count({ where: { storeId: store.id, reviews: { none: {} } } }),
      prisma.actionItem.findMany({ where: { storeId: store.id }, orderBy: { createdAt: "desc" }, take: 6, include: { recommendation: { select: { title: true, product: { select: { title: true } } } } } }),
      prisma.actionItem.groupBy({ by: ["status"], where: { storeId: store.id }, _count: true }),
      prisma.auditLog.findMany({ where: { storeId: store.id }, orderBy: { createdAt: "desc" }, take: 5, select: { id: true, event: true, message: true, createdAt: true } }),
    ]);

  // Toute intégration CATALOGUE connectée compte (04/09/2026 — Shopify n'est
  // plus la seule source de catalogue possible, voir WOOCOMMERCE/PRESTASHOP)
  // : le bouton "Synchroniser" ne doit jamais rester désactivé à tort pour
  // une boutique WooCommerce/PrestaShop connectée sans Shopify.
  const catalogConnected = integrations.some(
    (i) => (i.provider === "SHOPIFY" || i.provider === "WOOCOMMERCE" || i.provider === "PRESTASHOP") && i.status === "CONNECTED",
  );
  const judgemeConnected = integrations.find((i) => i.provider === "JUDGEME")?.status === "CONNECTED";
  const firstName = (user?.name ?? "").split(/\s+/)[0] || "";

  // Santé : score moyen + valeur normalisée moyenne de chaque facteur (0-100), réelles.
  const breakdowns: ScoreBreakdown[] = [];
  for (const s of latestScores) {
    try {
      breakdowns.push(JSON.parse(s.factorsJson) as ScoreBreakdown);
    } catch {
      // factorsJson illisible : exclu, jamais remplacé.
    }
  }
  const avgScore = latestScores.length > 0 ? Math.round(latestScores.reduce((a, s) => a + s.score, 0) / latestScores.length) : null;
  const factorAvg = new Map<string, { label: string; sum: number; n: number }>();
  for (const b of breakdowns) {
    for (const f of b.factors) {
      const e = factorAvg.get(f.key) ?? { label: f.label, sum: 0, n: 0 };
      if (f.available && f.normalizedValue !== null) {
        e.sum += f.normalizedValue;
        e.n += 1;
      }
      factorAvg.set(f.key, e);
    }
  }
  const factors = [...factorAvg.entries()].map(([key, e]) => ({ key, label: e.label, value: e.n > 0 ? Math.round(e.sum / e.n) : null }));
  const healthLabel = avgScore === null ? "Non disponible" : avgScore >= 70 ? "Bonne" : avgScore >= 50 ? "À améliorer" : "Critique";

  // « Qu'est-ce qui a changé » — santé : comparaison produit par produit
  // (voir whatChanged.ts), jamais deux moyennes sur des catalogues différents.
  const scoreTrend = computeScoreTrend(latestScores, historicalScores);

  const severityCounts = countBySeverity(recommendations);
  const allGroups = groupRecommendations(recommendations);
  const topGroups = allGroups.slice(0, 3);
  const next = allGroups[0] ?? null;
  const marginSignals = recommendations.filter((r) => r.category === "margin").length;

  // Performance & « Qu'est-ce qui a changé » — réelle (commandes non
  // annulées), sur la fenêtre choisie (7/30/90j) ; tendance affichée
  // seulement si la période PRÉCÉDENTE a assez de commandes (voir
  // minOrdersForTrend — un delta calculé sur 1-2 commandes est du bruit
  // présenté comme un insight, pas une information).
  const marginRowsTyped: MarginSnapshotRow[] = marginRows.map((r) => ({
    date: r.date,
    revenue: r.revenue,
    margin: r.margin,
    costCoverage: r.costCoverage,
    orderCount: r.orderCount,
    unitsSold: r.unitsSold,
  }));
  const perfCurrent = aggregateWindow(marginRowsTyped, sinceWindow, nowDate);
  const perfPrevious = aggregateWindow(marginRowsTyped, sincePrevWindow, sinceWindow);
  const revenueTrend = computeTrend(perfCurrent.revenue, perfPrevious.revenue, perfPrevious.orderCount, windowDays);
  const ordersTrend = computeTrend(perfCurrent.orderCount, perfPrevious.orderCount, perfPrevious.orderCount, windowDays);
  const marginRateDelta = marginRateDeltaPts(perfCurrent.marginRate, perfPrevious.marginRate);
  const basket = perfCurrent.orderCount > 0 ? perfCurrent.revenue / perfCurrent.orderCount : null;
  const daysWithData = marginRowsTyped.filter((r) => r.date.getTime() >= sinceWindow.getTime() && r.orderCount > 0);
  const hasChartData = daysWithData.length > 0;

  const ruptureProducts = Number(stockAgg[0]?.ruptureProducts ?? 0);
  const ruptureVariants = Number(stockAgg[0]?.ruptureVariants ?? 0);

  // Reprise d'état pour la décision prioritaire.
  const nextItemIds = next ? next.items.map((i) => i.id) : [];
  const existingActions = nextItemIds.length ? await prisma.actionItem.findMany({ where: { storeId: store.id, recommendationId: { in: nextItemIds } }, orderBy: { createdAt: "desc" } }) : [];
  const latestByRec = new Map<string, (typeof existingActions)[number]>();
  for (const a of existingActions) if (a.recommendationId && !latestByRec.has(a.recommendationId)) latestByRec.set(a.recommendationId, a);
  const actionsByRecommendation: Record<
    string,
    { id: string; type: string; sensitivity: "SENSITIVE" | "SAFE"; status: (typeof existingActions)[number]["status"]; payload: Record<string, unknown>; resultJson: string | null; createdAt: string; confirmedAt: string | null; executedAt: string | null }
  > = {};
  for (const [recId, a] of latestByRec) {
    actionsByRecommendation[recId] = {
      id: a.id,
      type: a.type,
      sensitivity: a.sensitivity as "SENSITIVE" | "SAFE",
      status: a.status,
      payload: JSON.parse(a.payloadJson) as Record<string, unknown>,
      resultJson: a.resultJson,
      createdAt: a.createdAt.toISOString(),
      confirmedAt: a.confirmedAt?.toISOString() ?? null,
      executedAt: a.executedAt?.toISOString() ?? null,
    };
  }
  const countByStatus = (s: string) => actionCounts.find((c) => c.status === s)?._count ?? 0;
  const pendingDecisions = countByStatus("PENDING_VALIDATION") + countByStatus("CONFIRMED");
  const failedTotal = countByStatus("FAILED");
  const executed7d = actionsRecent.filter((a) => a.status === "EXECUTED" && a.executedAt && a.executedAt >= since7d).length;

  const opportunityTiles = [
    { label: "Marge à optimiser", value: marginSignals, sub: "signaux sur coût réel", href: `/pricing?store=${store.id}&margin=low`, tone: "warning" },
    { label: "Stock à récupérer", value: ruptureProducts, sub: `${ruptureVariants.toLocaleString("fr-FR")} variantes à 0`, href: `/stock?store=${store.id}&status=critical`, tone: "danger" },
    { label: "Preuve sociale", value: noReviewCount, sub: "produits sans avis", href: `/reviews?store=${store.id}`, tone: "info" },
    { label: "Produits à promouvoir", value: severityCounts.opportunity, sub: "opportunités détectées", href: `/intelligence?store=${store.id}&filter=opportunity`, tone: "success" },
  ];

  return (
    <AppShell store={store} active="/dashboard" headerExtra={!store.isDemo ? <SyncButton storeId={store.id} shopifyConnected={catalogConnected} judgemeConnected={judgemeConnected} /> : undefined}>
      <div className="cc-greeting">
        <div>
          <h1 className="cc-title">
            {greeting()}
            {firstName ? ` ${firstName}` : ""}
          </h1>
          <p className="cc-subtitle">Voici ce qui mérite votre attention aujourd&apos;hui.</p>
        </div>
        <div className="cc-greeting-meta">
          <DataTag status="real" compact /> Dernière analyse : {lastAnalysis ? `${timeAgo(lastAnalysis.createdAt)} (${lastAnalysis.createdAt.toLocaleString("fr-FR")})` : "aucune"}
        </div>
      </div>

      {/* « Qu'est-ce qui a changé » (lot 6, 05/09/2026) — une fenêtre unique
          gouverne la santé et la performance ci-dessous. Liens simples
          (aucun JS client) : même convention que les autres filtres de
          l'application (voir /audit-log). */}
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

      <div className="cc-row cc-row-3">
        <section className="card cc-card" aria-labelledby="cc-health">
          <h2 id="cc-health" className="cc-card-title">
            Santé de votre boutique
          </h2>
          <div className="health-grid">
            <div className="health-ring-col">
              <HealthRing score={avgScore} size={132} />
              <div className={`health-label ${avgScore === null ? "" : avgScore >= 70 ? "is-ok" : avgScore >= 50 ? "is-warn" : "is-bad"}`}>{healthLabel}</div>
              <div className="health-sub">{latestScores.length.toLocaleString("fr-FR")} produits scorés</div>
              {scoreTrend.hasEnoughHistory && scoreTrend.deltaPts !== null ? (
                <div className={`health-trend ${scoreTrend.deltaPts > 0 ? "is-up" : scoreTrend.deltaPts < 0 ? "is-down" : ""}`}>
                  {scoreTrend.deltaPts > 0 ? "▲" : scoreTrend.deltaPts < 0 ? "▼" : "→"} {scoreTrend.deltaPts > 0 ? "+" : ""}
                  {scoreTrend.deltaPts} pt{Math.abs(scoreTrend.deltaPts) > 1 ? "s" : ""} sur {WINDOW_LABEL[windowDays]}
                  <span className="cell-sub"> (était {Math.round(scoreTrend.previousAvg ?? 0)}/100)</span>
                </div>
              ) : (
                <div className="cell-sub">
                  <DataTag status="unavailable" compact /> Historique insuffisant sur {WINDOW_LABEL[windowDays]}
                </div>
              )}
            </div>
            <ul className="health-factors">
              {factors.map((f) => (
                <li key={f.key} className="health-factor">
                  <span className="health-factor-label">{f.label}</span>
                  <span className="health-factor-bar" aria-hidden="true">
                    <span className="health-factor-fill" style={{ width: `${f.value ?? 0}%` }} />
                  </span>
                  <span className="health-factor-value">{f.value === null ? <span className="cell-sub">n/d</span> : `${f.value}/100`}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="cc-card-foot">
            <Link href={`/products?store=${store.id}`} className="section-link">
              Voir l&apos;analyse complète
            </Link>
            <span className="cell-sub">Facteur indisponible = n/d, jamais compté à 0.</span>
          </div>
        </section>

        <section className="card cc-card" aria-labelledby="cc-priorities">
          <h2 id="cc-priorities" className="cc-card-title">
            Vos priorités du jour <span className="cc-count">{allGroups.length.toLocaleString("fr-FR")}</span>
          </h2>
          {topGroups.length === 0 ? (
            <p className="unavailable-note">Aucune recommandation ouverte.</p>
          ) : (
            <ul className="priority-rows">
              {topGroups.map((g) => {
                const meta = SEVERITY_META[g.severity as keyof typeof SEVERITY_META] ?? SEVERITY_META.SUGGESTION;
                const payload = g.representative.actionPayloadJson ? (JSON.parse(g.representative.actionPayloadJson) as { variantId?: string }) : null;
                const href = g.representative.actionType === "update_price" && payload?.variantId ? `/pricing/${payload.variantId}?store=${store.id}` : `/intelligence?store=${store.id}&q=${encodeURIComponent(g.product?.title ?? g.title)}`;
                return (
                  <li key={g.key} className={`priority-row priority-row-${meta.cls}`}>
                    <Link href={href} className="priority-row-link">
                      <span className="priority-row-kicker">{meta.label}</span>
                      <span className="priority-row-title">{g.title}</span>
                      <span className="priority-row-sub">{g.representative.impact}</span>
                      <ArrowRight size={16} className="priority-row-arrow" aria-hidden="true" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
          <Link href={`/intelligence?store=${store.id}`} className="section-link">
            Voir toutes les priorités
          </Link>
        </section>

        <section className="card cc-card cc-brief" aria-labelledby="cc-brief">
          <h2 id="cc-brief" className="cc-card-title">
            <Sparkles size={15} aria-hidden="true" /> Brief du jour
          </h2>
          <p className="cell-sub">{lastAnalysis ? `Analyse recalculée ${timeAgo(lastAnalysis.createdAt)} sur ${productCount.toLocaleString("fr-FR")} produits réels.` : "Aucune analyse n'a encore été calculée."}</p>
          <div className="brief-counts">
            <div>
              <span className="brief-count is-danger">{severityCounts.urgent.toLocaleString("fr-FR")}</span>
              <span className="brief-count-label">Problèmes critiques</span>
            </div>
            <div>
              <span className="brief-count is-warning">{severityCounts.opportunity.toLocaleString("fr-FR")}</span>
              <span className="brief-count-label">Opportunités</span>
            </div>
            <div>
              <span className="brief-count is-success">{severityCounts.suggestion.toLocaleString("fr-FR")}</span>
              <span className="brief-count-label">Recommandations</span>
            </div>
          </div>
          <div className="brief-priority">
            <span className="brief-priority-kicker">Votre priorité n°1</span>
            <span className="brief-priority-title">{next ? next.title : "Aucun signal ouvert"}</span>
            {next && (
              <a href="#next-action" className="btn btn-primary btn-sm">
                Analyser maintenant <ArrowRight size={14} aria-hidden="true" />
              </a>
            )}
          </div>
        </section>
      </div>

      <ol className="flow-strip" aria-label="Pipeline décisionnel">
        <FlowStage step="Signal" value={severityCounts.total} hint={`${marginSignals.toLocaleString("fr-FR")} sur la marge`} tag="calculated" href={`/intelligence?store=${store.id}`} />
        <FlowStage step="Risques / opportunités" value={`${severityCounts.urgent.toLocaleString("fr-FR")} / ${severityCounts.opportunity.toLocaleString("fr-FR")}`} tag="calculated" tone={severityCounts.urgent > 0 ? "danger" : undefined} href={`/intelligence?store=${store.id}&filter=urgent`} />
        <FlowStage step="Priorités" value={allGroups.length} hint="groupes par produit" tag="calculated" href={`/intelligence?store=${store.id}`} />
        <FlowStage step="Décisions" value={pendingDecisions} hint={`${executed7d} exécutée${executed7d > 1 ? "s" : ""} 7 j · ${failedTotal} à reprendre`} tag="real" tone={failedTotal > 0 ? "danger" : pendingDecisions > 0 ? "warning" : undefined} href={`/actions?store=${store.id}`} />
        <FlowStage step="Prochaine action" value={next ? (next.representative.actionLabel ?? "Examiner") : "—"} hint={next ? next.title : "aucun signal"} tag={next ? "calculated" : "unavailable"} href="#next-action" emphasis />
      </ol>

      <div className="cc-row cc-row-2">
        <section className="card cc-card" aria-labelledby="cc-perf">
          <div className="cc-card-head">
            <h2 id="cc-perf" className="cc-card-title">
              Performance globale
            </h2>
            <span className="cc-card-hint">{WINDOW_LABEL[windowDays]} · commandes non annulées, remboursements non déduits</span>
          </div>
          <div className="kpi-row">
            <Kpi label="Ventes brutes" value={perfCurrent.orderCount > 0 ? eur(perfCurrent.revenue) : "—"} trend={revenueTrend.label} tag={perfCurrent.orderCount > 0 ? "real" : "unavailable"} />
            <Kpi label="Commandes" value={perfCurrent.orderCount.toLocaleString("fr-FR")} trend={ordersTrend.label} tag="real" />
            <Kpi label="Panier moyen" value={basket !== null ? eur(basket) : "—"} tag={basket !== null ? "calculated" : "unavailable"} />
            <Kpi label="Unités vendues" value={perfCurrent.unitsSold.toLocaleString("fr-FR")} tag="real" />
            <Kpi
              label="Marge"
              value={perfCurrent.marginRate !== null ? `${(perfCurrent.marginRate * 100).toFixed(1)} %` : "—"}
              trend={marginRateDelta !== null ? `${marginRateDelta >= 0 ? "+" : ""}${marginRateDelta.toFixed(1)} pt` : null}
              tag={perfCurrent.marginRate !== null ? "calculated" : "unavailable"}
              hint={perfCurrent.marginRate === null ? "Coût fournisseur non renseigné" : undefined}
            />
            <Kpi label="Conversion" value="—" tag="unavailable" hint="Sessions non intégrées" />
          </div>
          {hasChartData ? (
            <SalesChart points={daysWithData.map((d) => ({ date: d.date, revenue: d.revenue }))} />
          ) : (
            <div className="chart-empty">
              <DataTag status="unavailable" compact /> Aucune vente enregistrée sur {WINDOW_LABEL[windowDays]} — la courbe apparaîtra avec les premières commandes.
              {perfPrevious.orderCount > 0 && (
                <span className="cell-sub">
                  {" "}
                  ({perfPrevious.orderCount} commande{perfPrevious.orderCount > 1 ? "s" : ""} sur {WINDOW_LABEL[windowDays]} précédent{windowDays > 1 ? "s" : ""})
                </span>
              )}
            </div>
          )}
        </section>

        <section className="card cc-card" aria-labelledby="cc-signals">
          <div className="cc-card-head">
            <h2 id="cc-signals" className="cc-card-title">
              Signaux récents
            </h2>
            <Link href={`/audit-log?store=${store.id}`} className="section-link" style={{ marginTop: 0 }}>
              Voir tout
            </Link>
          </div>
          {recentEvents.length === 0 ? (
            <p className="unavailable-note">Aucun événement.</p>
          ) : (
            <ul className="signal-list">
              {recentEvents.map((e) => (
                <li key={e.id} className={`signal-item signal-${e.event.includes("failed") ? "danger" : e.event.startsWith("action") ? "info" : "neutral"}`}>
                  <span className="signal-dot" aria-hidden="true" />
                  <span className="signal-body">
                    <span className="signal-title">{EVENT_LABEL[e.event] ?? e.event}</span>
                    <span className="signal-message">{e.message}</span>
                  </span>
                  <span className="signal-time">{timeAgo(e.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="cc-row cc-row-2">
        <section className="card cc-card" aria-labelledby="cc-opps">
          <h2 id="cc-opps" className="cc-card-title">
            Opportunités à saisir
          </h2>
          <div className="opp-grid">
            {opportunityTiles.map((t) => (
              <Link key={t.label} href={t.href} className={`opp-tile opp-tile-${t.tone}`}>
                <span className="opp-tile-label">{t.label}</span>
                <span className="opp-tile-value">
                  {t.value.toLocaleString("fr-FR")} <DataTag status="calculated" compact />
                </span>
                <span className="opp-tile-sub">{t.sub}</span>
                <span className="opp-tile-cta">
                  Voir <ArrowRight size={13} aria-hidden="true" />
                </span>
              </Link>
            ))}
          </div>
        </section>

        <section className="card cc-card cc-ai" aria-labelledby="cc-ai">
          <h2 id="cc-ai" className="cc-card-title">
            <span className="ai-mark" aria-hidden="true">
              <Sparkles size={14} />
            </span>
            OnDeal AI
          </h2>
          <p className="cell-sub">Votre copilote e-commerce — répond uniquement à partir des données réelles calculées ci-dessus.</p>
          <div className="ai-chips">
            {["Que dois-je faire aujourd'hui ?", "Quels produits risquent une rupture ?", "Où est ma mauvaise marge ?"].map((q) => (
              <Link key={q} href={`/assistant?store=${store.id}`} className="ai-chip">
                {q}
              </Link>
            ))}
          </div>
          <Link href={`/assistant?store=${store.id}`} className="btn btn-primary" style={{ width: "100%", justifyContent: "center" }}>
            Discuter avec OnDeal AI
          </Link>
        </section>
      </div>

      <div className="cc-row cc-row-2 cc-row-decision">
        <section className="card cc-card" id="next-action" aria-labelledby="cc-next">
          <div className="cc-card-head">
            <h2 id="cc-next" className="cc-card-title">
              Décision prioritaire
            </h2>
            <span className="cc-card-hint">Signal → scénario → validation humaine → action → résultat</span>
          </div>
          {next ? (
            <DecisionCard group={lightenGroup(next, 10)} storeId={store.id} existingAction={actionsByRecommendation[next.representative.id] ?? null} actionsByRecommendation={actionsByRecommendation} />
          ) : (
            <p className="unavailable-note">Aucune recommandation — synchronisez vos données pour lancer la première analyse.</p>
          )}
        </section>

        <section className="card cc-card" aria-labelledby="cc-decisions">
          <div className="cc-card-head">
            <h2 id="cc-decisions" className="cc-card-title">
              Décisions en cours
            </h2>
            <Link href={`/actions?store=${store.id}`} className="section-link" style={{ marginTop: 0 }}>
              Toutes
            </Link>
          </div>
          {actionsRecent.length === 0 ? (
            <p className="unavailable-note">Aucune décision engagée pour le moment.</p>
          ) : (
            <ul className="decision-list">
              {actionsRecent.map((a) => {
                const phase = derivePhaseFromExistingAction({ status: a.status, sensitivity: a.sensitivity, resultJson: a.resultJson });
                const meta = PHASE_LABEL[phase] ?? PHASE_LABEL.signal!;
                let payload: Record<string, unknown> = {};
                try {
                  payload = JSON.parse(a.payloadJson) as Record<string, unknown>;
                } catch {
                  payload = {};
                }
                const prediction = isPricePrediction(payload.prediction) ? payload.prediction : null;
                return (
                  <li key={a.id} className="decision-list-item">
                    <div className="decision-list-head">
                      <span className={`phase-pill phase-pill-${a.status === "CANCELLED" ? "neutral" : meta.tone}`}>{a.status === "CANCELLED" ? "Annulée" : meta.label}</span>
                      <span className="decision-list-type">
                        {TYPE_LABEL[a.type] ?? a.type} · {actionKindFor(a.type) === "automated_mutation" ? "automatisée" : "mission"}
                      </span>
                    </div>
                    <div className="decision-list-title">{a.recommendation?.product?.title ?? a.recommendation?.title ?? "—"}</div>
                    {prediction && (
                      <div className="decision-list-sub">
                        Prédit : {prediction.priceBefore?.toFixed(2) ?? "—"} → {prediction.newPrice.toFixed(2)} € · marge brute {prediction.grossMarginAfter !== null ? `${prediction.grossMarginAfter.toFixed(2)} €` : "n/d"}
                      </div>
                    )}
                    <div className="decision-list-sub">{timeAgo(a.executedAt ?? a.confirmedAt ?? a.createdAt)}</div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </AppShell>
  );
}

function Kpi({ label, value, trend, tag, hint }: { label: string; value: string; trend?: string | null; tag: "real" | "calculated" | "estimated" | "unavailable"; hint?: string }) {
  return (
    <div className="kpi">
      <span className="kpi-label">
        {label} <DataTag status={tag} compact />
      </span>
      <span className="kpi-value">
        {value}
        {trend && <span className={`kpi-trend ${trend.startsWith("-") ? "is-down" : "is-up"}`}>{trend}</span>}
      </span>
      {hint && <span className="kpi-hint">{hint}</span>}
    </div>
  );
}

/** Ventes journalières RÉELLES (SalesSnapshot) — rendu uniquement quand au moins un jour a une vente. */
function SalesChart({ points }: { points: Array<{ date: Date; revenue: number }> }) {
  const w = 720;
  const h = 150;
  const pad = { l: 44, r: 10, t: 10, b: 24 };
  const max = Math.max(...points.map((p) => p.revenue), 1);
  const bw = (w - pad.l - pad.r) / points.length;
  const y = (v: number) => pad.t + (h - pad.t - pad.b) * (1 - v / max);
  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Ventes brutes journalières sur ${points.length} jours avec vente`}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={pad.l} x2={w - pad.r} y1={y(max * f)} y2={y(max * f)} className="chart-grid" />
            <text x={pad.l - 6} y={y(max * f) + 4} className="chart-axis" textAnchor="end">
              {Math.round(max * f)}
            </text>
          </g>
        ))}
        {points.map((p, i) => (
          <rect key={i} x={pad.l + i * bw + 1} y={y(p.revenue)} width={Math.max(2, bw - 2)} height={h - pad.b - y(p.revenue)} className="chart-bar">
            <title>
              {p.date.toLocaleDateString("fr-FR")} : {p.revenue.toFixed(2)} €
            </title>
          </rect>
        ))}
        <text x={pad.l} y={h - 6} className="chart-axis">
          {points[0]!.date.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}
        </text>
        <text x={w - pad.r} y={h - 6} className="chart-axis" textAnchor="end">
          {points[points.length - 1]!.date.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}
        </text>
      </svg>
      <figcaption className="cell-sub">Seuls les jours avec au moins une vente ont une barre (agrégat réel produit × jour).</figcaption>
    </figure>
  );
}

function FlowStage({ step, value, hint, tag, tone, href, emphasis }: { step: string; value: number | string; hint?: string; tag: "real" | "calculated" | "estimated" | "unavailable"; tone?: "danger" | "warning"; href: string; emphasis?: boolean }) {
  return (
    <li className={`flow-stage${tone ? ` flow-stage-${tone}` : ""}${emphasis ? " flow-stage-emphasis" : ""}`}>
      <Link href={href} className="flow-stage-link">
        <span className="flow-stage-step">
          {step} <DataTag status={tag} compact />
        </span>
        <span className="flow-stage-value">{typeof value === "number" ? value.toLocaleString("fr-FR") : value}</span>
        {hint && <span className="flow-stage-hint">{hint}</span>}
      </Link>
    </li>
  );
}
