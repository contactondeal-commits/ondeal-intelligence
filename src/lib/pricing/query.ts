import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { analyzeMargin, MARGIN_THRESHOLDS } from "@/lib/intelligence/margin";
import { resolveCostInputs } from "@/lib/intelligence/costs";
import type { MarginAnalysis } from "@/types";
import { derivePhaseFromExistingAction, type DecisionPhase } from "@/lib/intelligence/decision";

/**
 * Accès données de la page Prix & Marge — pagination, recherche, filtres et
 * tri faits PAR LA BASE (jamais 16 407 variantes chargées puis filtrées en
 * mémoire). Le SQL ne sert qu'à sélectionner/ordonner les lignes ; chaque
 * valeur AFFICHÉE est ensuite calculée par `analyzeMargin` (source unique
 * des formules — ANALYSE = SIMULATION). Le seul calcul dupliqué en SQL est
 * la marge brute (prix − coût) / prix, utilisée pour le tri et les
 * compteurs, avec les mêmes seuils (`MARGIN_THRESHOLDS`).
 */

export type CostFilter = "all" | "real" | "fallback" | "none";
export type MarginFilter = "all" | "negative" | "low" | "mid" | "high" | "unavailable";
export type PricingSort = "gross_asc" | "gross_desc" | "price_asc" | "price_desc" | "stock_asc" | "title";

export interface PricingQuery {
  q?: string;
  cost?: CostFilter;
  margin?: MarginFilter;
  sort?: PricingSort;
  page: number;
  pageSize: number;
}

export interface PricingRow {
  variantId: string;
  productId: string;
  productTitle: string;
  variantTitle: string;
  variantCount: number;
  sku: string | null;
  inventoryQuantity: number | null;
  analysis: MarginAnalysis;
  /** Recommandation de marge OPEN ciblant cette variante (accès au Decision Workspace). */
  openRecommendationId: string | null;
  /** Signal réel : sévérité et libellé de la recommandation ouverte. */
  signal: { severity: "URGENT" | "OPPORTUNITY" | "SUGGESTION"; label: string } | null;
  /** État réel de la décision engagée sur ce signal (dérivé de l'ActionItem la plus récente), ou null. */
  phase: DecisionPhase | null;
}

export interface PricingSummary {
  variants: number;
  withRealCost: number;
  withFallbackCost: number;
  withoutCost: number;
  grossNegative: number;
  grossLow: number;
  /** Variantes pour lesquelles la marge complète est calculable (hypothèses présentes). */
  fullMarginComputable: number;
}

const LOW = MARGIN_THRESHOLDS.faibleRate;
const HIGH = MARGIN_THRESHOLDS.fortRate;

// Coût fournisseur effectif en SQL : coût réel Shopify prioritaire, hypothèse
// produit en repli — même règle que costs.ts (utilisée uniquement pour
// filtrer/trier ; les valeurs affichées passent par resolveCostInputs).
const COST_EXPR = Prisma.sql`COALESCE(v."unitCost", ca."supplierCost")`;
const GROSS_RATE_EXPR = Prisma.sql`CASE WHEN v.price > 0 AND COALESCE(v."unitCost", ca."supplierCost") IS NOT NULL THEN (v.price - COALESCE(v."unitCost", ca."supplierCost")) / v.price END`;

function whereClause(storeId: string, query: PricingQuery): Prisma.Sql {
  const parts: Prisma.Sql[] = [Prisma.sql`p."storeId" = ${storeId}`];
  if (query.q && query.q.trim()) {
    const like = `%${query.q.trim()}%`;
    parts.push(Prisma.sql`(p.title ILIKE ${like} OR v.title ILIKE ${like} OR v.sku ILIKE ${like})`);
  }
  switch (query.cost) {
    case "real":
      parts.push(Prisma.sql`v."unitCost" IS NOT NULL`);
      break;
    case "fallback":
      parts.push(Prisma.sql`v."unitCost" IS NULL AND ca."supplierCost" IS NOT NULL`);
      break;
    case "none":
      parts.push(Prisma.sql`v."unitCost" IS NULL AND ca."supplierCost" IS NULL`);
      break;
  }
  switch (query.margin) {
    case "negative":
      parts.push(Prisma.sql`${GROSS_RATE_EXPR} < 0`);
      break;
    case "low":
      parts.push(Prisma.sql`${GROSS_RATE_EXPR} >= 0 AND ${GROSS_RATE_EXPR} < ${LOW}`);
      break;
    case "mid":
      parts.push(Prisma.sql`${GROSS_RATE_EXPR} >= ${LOW} AND ${GROSS_RATE_EXPR} < ${HIGH}`);
      break;
    case "high":
      parts.push(Prisma.sql`${GROSS_RATE_EXPR} >= ${HIGH}`);
      break;
    case "unavailable":
      parts.push(Prisma.sql`(${COST_EXPR} IS NULL OR v.price IS NULL OR v.price <= 0)`);
      break;
  }
  return Prisma.join(parts, " AND ");
}

function orderClause(sort: PricingSort | undefined): Prisma.Sql {
  switch (sort) {
    case "gross_desc":
      return Prisma.sql`ORDER BY (${GROSS_RATE_EXPR} IS NULL) ASC, ${GROSS_RATE_EXPR} DESC, p.title ASC`;
    case "price_asc":
      return Prisma.sql`ORDER BY v.price ASC, p.title ASC`;
    case "price_desc":
      return Prisma.sql`ORDER BY v.price DESC, p.title ASC`;
    case "stock_asc":
      return Prisma.sql`ORDER BY v."inventoryQuantity" ASC, p.title ASC`;
    case "title":
      return Prisma.sql`ORDER BY p.title ASC, v.title ASC`;
    case "gross_asc":
    default:
      // Décision d'abord : les marges brutes les plus faibles en tête, les
      // variantes sans coût (non calculables) en fin de liste.
      return Prisma.sql`ORDER BY (${GROSS_RATE_EXPR} IS NULL) ASC, ${GROSS_RATE_EXPR} ASC, p.title ASC`;
  }
}

const FROM = Prisma.sql`FROM variants v JOIN products p ON p.id = v."productId" LEFT JOIN cost_assumptions ca ON ca."productId" = p.id`;

export async function queryPricingRows(storeId: string, query: PricingQuery): Promise<{ rows: PricingRow[]; total: number }> {
  const where = whereClause(storeId, query);
  const [countRow] = await prisma.$queryRaw<Array<{ c: number | bigint }>>(Prisma.sql`SELECT COUNT(*) AS c ${FROM} WHERE ${where}`);
  const total = Number(countRow?.c ?? 0);

  const ids = await prisma.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT v.id ${FROM} WHERE ${where} ${orderClause(query.sort)} LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`,
  );
  if (ids.length === 0) return { rows: [], total };

  const [variants, store] = await Promise.all([
    prisma.variant.findMany({
      where: { id: { in: ids.map((r) => r.id) } },
      include: { product: { select: { id: true, title: true, costAssumption: true, _count: { select: { variants: true } } } } },
    }),
    prisma.store.findUnique({ where: { id: storeId }, select: { defaultShippingCost: true, defaultPaymentFeesRate: true } }),
  ]);
  const byId = new Map(variants.map((v) => [v.id, v]));

  // Recommandations de marge OPEN → accès direct au Decision Workspace.
  const openMarginRecs = await prisma.recommendation.findMany({
    where: { storeId, status: "OPEN", category: "margin", actionType: "update_price" },
    select: { id: true, severity: true, title: true, actionPayloadJson: true },
  });
  const recByVariant = new Map<string, (typeof openMarginRecs)[number]>();
  for (const r of openMarginRecs) {
    try {
      const payload = JSON.parse(r.actionPayloadJson ?? "{}") as { variantId?: string };
      if (payload.variantId && !recByVariant.has(payload.variantId)) recByVariant.set(payload.variantId, r);
    } catch {
      // payload illisible : pas de lien, jamais une erreur de page
    }
  }
  // État réel des décisions engagées sur les signaux de cette page.
  const pageRecIds = ids.map((r) => recByVariant.get(r.id)?.id).filter((x): x is string => !!x);
  const actions = pageRecIds.length
    ? await prisma.actionItem.findMany({ where: { storeId, recommendationId: { in: pageRecIds } }, orderBy: { createdAt: "desc" }, select: { recommendationId: true, status: true, sensitivity: true, resultJson: true } })
    : [];
  const latestActionByRec = new Map<string, (typeof actions)[number]>();
  for (const a of actions) if (a.recommendationId && !latestActionByRec.has(a.recommendationId)) latestActionByRec.set(a.recommendationId, a);

  const rows: PricingRow[] = [];
  for (const { id } of ids) {
    const v = byId.get(id);
    if (!v) continue;
    const rec = recByVariant.get(v.id);
    const costs = resolveCostInputs(v, v.product.costAssumption, store);
    const analysis = analyzeMargin({
      productId: v.product.id,
      variantId: v.id,
      title: v.product._count.variants > 1 ? `${v.product.title} — ${v.title}` : v.product.title,
      sellingPrice: v.price,
      supplierCost: costs.supplierCost,
      supplierCostSource: costs.supplierCostSource,
      shippingCost: costs.shippingCost,
      paymentFeesRate: costs.paymentFeesRate,
      otherFixedCost: costs.otherFixedCost,
    });
    rows.push({
      variantId: v.id,
      productId: v.product.id,
      productTitle: v.product.title,
      variantTitle: v.title,
      variantCount: v.product._count.variants,
      sku: v.sku,
      inventoryQuantity: v.inventoryQuantity,
      analysis,
      openRecommendationId: rec?.id ?? null,
      signal: rec ? { severity: rec.severity, label: rec.title.split(" — ")[0] ?? rec.title } : null,
      phase: rec && latestActionByRec.get(rec.id) ? derivePhaseFromExistingAction(latestActionByRec.get(rec.id)!) : null,
    });
  }
  return { rows, total };
}

export async function pricingSummary(storeId: string): Promise<PricingSummary> {
  const store = await prisma.store.findUnique({ where: { id: storeId }, select: { defaultShippingCost: true, defaultPaymentFeesRate: true } });
  const storeShipping = store?.defaultShippingCost ?? null;
  const storeFees = store?.defaultPaymentFeesRate ?? null;
  const [row] = await prisma.$queryRaw<
    Array<{ variants: number | bigint; real: number | bigint; fallback: number | bigint; none: number | bigint; neg: number | bigint; low: number | bigint; full: number | bigint }>
  >(Prisma.sql`
    SELECT
      COUNT(*) AS variants,
      SUM(CASE WHEN v."unitCost" IS NOT NULL THEN 1 ELSE 0 END) AS real,
      SUM(CASE WHEN v."unitCost" IS NULL AND ca."supplierCost" IS NOT NULL THEN 1 ELSE 0 END) AS fallback,
      SUM(CASE WHEN v."unitCost" IS NULL AND ca."supplierCost" IS NULL THEN 1 ELSE 0 END) AS none,
      SUM(CASE WHEN ${GROSS_RATE_EXPR} < 0 THEN 1 ELSE 0 END) AS neg,
      SUM(CASE WHEN ${GROSS_RATE_EXPR} >= 0 AND ${GROSS_RATE_EXPR} < ${LOW} THEN 1 ELSE 0 END) AS low,
      SUM(CASE WHEN ${COST_EXPR} IS NOT NULL AND v.price IS NOT NULL
                AND COALESCE(ca."shippingCost", ${storeShipping}) IS NOT NULL
                AND COALESCE(ca."paymentFeesRate", ${storeFees}) IS NOT NULL THEN 1 ELSE 0 END) AS full
    ${FROM} WHERE p."storeId" = ${storeId}
  `);
  return {
    variants: Number(row?.variants ?? 0),
    withRealCost: Number(row?.real ?? 0),
    withFallbackCost: Number(row?.fallback ?? 0),
    withoutCost: Number(row?.none ?? 0),
    grossNegative: Number(row?.neg ?? 0),
    grossLow: Number(row?.low ?? 0),
    fullMarginComputable: Number(row?.full ?? 0),
  };
}
