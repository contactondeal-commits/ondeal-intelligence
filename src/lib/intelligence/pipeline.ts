import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { analyzeStock, type StockInput } from "@/lib/intelligence/stock";
import { analyzeMargin, type MarginInput } from "@/lib/intelligence/margin";
import { resolveCostInputs } from "@/lib/intelligence/costs";
import { salesWindowStart, unitsSoldInWindow } from "@/lib/intelligence/salesWindow";
import { computeScore, type ScoreInputs } from "@/lib/intelligence/score";
import { analyzeReviews } from "@/lib/intelligence/reviews";
import { generateRecommendations, type RecommendationContext } from "@/lib/intelligence/recommendations";
import type { MarginAnalysis, StockAnalysis } from "@/types";

/**
 * ANALYZE → INSIGHTS (fin du pipeline PHASE 15). Recalcule, à partir des
 * données déjà stockées (donc déjà validées/normalisées), l'ensemble des
 * modules d'intelligence pour une boutique : Stock, Marge, Score, Avis,
 * puis régénère les recommandations ouvertes. Appelé après chaque
 * synchronisation, et peut aussi être appelé manuellement (ex. après
 * modification des hypothèses de coût dans Price & Margin Intelligence).
 */
export async function recomputeStoreIntelligence(storeId: string): Promise<void> {
  const storeDefaults = await prisma.store.findUnique({
    where: { id: storeId },
    select: { defaultShippingCost: true, defaultPaymentFeesRate: true },
  });
  const products = await prisma.product.findMany({
    where: { storeId },
    include: {
      variants: true,
      costAssumption: true,
      salesSnapshots: { where: { date: { gte: salesWindowStart() } }, select: { unitsSold: true } },
      reviews: true,
      _count: { select: { salesSnapshots: true } },
    },
  });

  const reviews = await prisma.review.findMany({ where: { storeId } });

  const stockAnalyses: StockAnalysis[] = [];
  const marginAnalyses: MarginAnalysis[] = [];
  const activeWithoutStock: Array<{ productId: string; title: string }> = [];
  const reviewsWithoutAny: Array<{ productId: string; title: string }> = [];
  const scoreRows: Array<{ productId: string; title: string; score: number; dataCompleteness: number }> = [];

  for (const p of products) {
    // 30 derniers jours calendaires (voir salesWindow.ts) — jamais "30 dernières lignes".
    const unitsSoldLast30Days = unitsSoldInWindow(p.salesSnapshots, p._count.salesSnapshots > 0);

    const totalStoreStock = p.variants.reduce(
      (sum, v) => (v.inventoryQuantity !== null ? sum + v.inventoryQuantity : sum),
      0,
    );
    const anyStockKnown = p.variants.some((v) => v.inventoryQuantity !== null);
    const totalSupplierStock = p.variants.some((v) => v.supplierStock !== null)
      ? p.variants.reduce((sum, v) => sum + (v.supplierStock ?? 0), 0)
      : null;

    for (const v of p.variants) {
      const input: StockInput = {
        productId: p.id,
        variantId: v.id,
        title: p.variants.length > 1 ? `${p.title} — ${v.title}` : p.title,
        sku: v.sku,
        storeStock: v.inventoryQuantity,
        supplierStock: v.supplierStock,
        unitsSoldLast30Days,
        lastSyncedAt: v.updatedAt.toISOString(),
      };
      stockAnalyses.push(analyzeStock(input));

      // Coût réel Shopify prioritaire, hypothèses OnDeal en repli — voir costs.ts.
      const costs = resolveCostInputs(v, p.costAssumption, storeDefaults);
      const marginInput: MarginInput = {
        productId: p.id,
        variantId: v.id,
        title: p.variants.length > 1 ? `${p.title} — ${v.title}` : p.title,
        sellingPrice: v.price,
        supplierCost: costs.supplierCost,
        supplierCostSource: costs.supplierCostSource,
        shippingCost: costs.shippingCost,
        paymentFeesRate: costs.paymentFeesRate,
        otherFixedCost: costs.otherFixedCost,
      };
      marginAnalyses.push(analyzeMargin(marginInput));
    }

    if (p.status === "active" && anyStockKnown && totalStoreStock === 0) {
      activeWithoutStock.push({ productId: p.id, title: p.title });
    }
    if (p.reviews.length === 0) {
      reviewsWithoutAny.push({ productId: p.id, title: p.title });
    }

    const productReviews = p.reviews;
    const avgRating =
      productReviews.length > 0
        ? productReviews.reduce((sum, r) => sum + r.rating, 0) / productReviews.length
        : null;

    const daysOfStockValues = stockAnalyses
      .filter((s) => s.productId === p.id && s.daysOfStock !== null)
      .map((s) => s.daysOfStock as number);
    const stockHealth =
      totalStoreStock === 0 && anyStockKnown
        ? 0
        : daysOfStockValues.length > 0
          ? clampScore(100 - Math.abs(30 - avgOf(daysOfStockValues)) * 1.5)
          : null;

    const marginRateValues = marginAnalyses
      .filter((m) => m.productId === p.id && m.marginRate !== null)
      .map((m) => m.marginRate as number);
    const marginRate = marginRateValues.length > 0 ? avgOf(marginRateValues) : null;

    const scoreInputs: ScoreInputs = {
      salesTrend: null, // nécessite un historique comparatif sur plusieurs périodes — non encore accumulé (Phase "prochaines améliorations")
      marginRate,
      stockHealth,
      averageRating: avgRating,
      reviewCount: productReviews.length,
      contentQuality: computeContentQuality(p),
    };

    const breakdown = computeScore(scoreInputs);

    await prisma.scoreSnapshot.create({
      data: {
        storeId,
        productId: p.id,
        score: breakdown.score,
        factorsJson: JSON.stringify(breakdown),
      },
    });

    scoreRows.push({ productId: p.id, title: p.title, score: breakdown.score, dataCompleteness: breakdown.dataCompleteness });
  }

  const reviewAnalysis = analyzeReviews({
    storeId,
    reviews: reviews.map((r) => ({ productId: r.productId, rating: r.rating, title: r.title, body: r.body, publishedAt: r.publishedAt })),
    totalProductCount: products.length,
  });

  const ctx: RecommendationContext = {
    stock: stockAnalyses,
    margin: marginAnalyses,
    score: scoreRows,
    reviewsWithoutAny,
    activeWithoutStock,
    dataIssues: [],
  };

  const generated = generateRecommendations(ctx);

  // Les recommandations OPEN sont régénérées à chaque cycle (dérivées d'un
  // état actuel) ; les recommandations déjà ACTIONED/DISMISSED restent en
  // base comme historique (jamais supprimées silencieusement).
  await prisma.recommendation.deleteMany({ where: { storeId, status: "OPEN" } });
  if (generated.length > 0) {
    await prisma.recommendation.createMany({
      data: generated.map((r) => ({
        storeId,
        productId: r.productId,
        category: r.category,
        severity: r.severity,
        title: r.title,
        reason: r.reason,
        impact: r.impact,
        confidence: r.confidence,
        impactScore: r.impactScore ?? null,
        actionLabel: r.actionLabel,
        actionType: r.actionType,
        actionPayloadJson: r.actionPayload ? JSON.stringify(r.actionPayload) : null,
      })),
    });
  }

  await logAudit({
    storeId,
    actorType: "system",
    event: "intelligence.recomputed",
    message: `Analyse recalculée : ${products.length} produit(s), ${generated.length} recommandation(s) active(s), note moyenne ${
      reviewAnalysis.averageRating !== null ? reviewAnalysis.averageRating.toFixed(2) : "non disponible"
    }.`,
    meta: { productCount: products.length, recommendationCount: generated.length },
  });
}

function computeContentQuality(p: { imageUrl: string | null; productType: string | null; title: string }): number | null {
  // Critères objectifs et vérifiables — jamais un jugement subjectif.
  let points = 0;
  let total = 0;
  total += 1;
  if (p.imageUrl) points += 1;
  total += 1;
  if (p.productType) points += 1;
  total += 1;
  if (p.title && p.title.length >= 15) points += 1;
  return total > 0 ? (points / total) * 100 : null;
}

function avgOf(values: number[]): number {
  return values.reduce((s, v) => s + v, 0) / values.length;
}
function clampScore(v: number): number {
  return Math.max(0, Math.min(100, v));
}
