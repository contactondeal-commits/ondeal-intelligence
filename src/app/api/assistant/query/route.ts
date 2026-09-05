import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireStoreAccess, AuthError } from "@/lib/auth";
import { answerQuestion, type AssistantContext, type PageProductContext } from "@/lib/intelligence/assistant";
import { analyzeStock, type StockInput } from "@/lib/intelligence/stock";
import { resolveCostInputs } from "@/lib/intelligence/costs";
import { analyzeMargin, summarizeGrossMargin } from "@/lib/intelligence/margin";
import { aggregateProductSalesWindow, computeProductSalesTrend, type ProductSalesRow } from "@/lib/intelligence/productSales";
import { logAudit } from "@/lib/audit";
import { z } from "zod";
import { hasFeature } from "@/lib/plan-limits";

const CONTEXT_PRODUCT_WINDOW_DAYS = 30;

const bodySchema = z
  .object({
    storeId: z.string().min(1).max(64),
    question: z.string().trim().min(1).max(1000),
    // LOT 10 — id du produit affiché sur la page d'où la question est posée
    // (fiche Product Intelligence). Optionnel : une question générale n'a
    // pas de contexte produit. Toujours revérifié comme appartenant à la
    // boutique demandée avant tout usage (voir plus bas) — jamais fait
    // confiance à un id transmis par le client.
    contextProductId: z.string().min(1).max(64).optional(),
  })
  .strict();

export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Champs manquants ou invalides." }, { status: 400 });
  const { storeId, question, contextProductId } = parsed.data;

  let userId: string;
  let plan: string;
  try {
    ({ userId } = await requireStoreAccess(storeId));
    const planRow = await prisma.store.findUnique({ where: { id: storeId }, select: { organization: { select: { plan: true } } } });
    if (!planRow || !hasFeature(planRow.organization.plan, "assistant")) return NextResponse.json({ error: "Module non inclus dans votre plan." }, { status: 403 });
    plan = planRow.organization.plan;
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }

  const [store, recommendations, products, salesCount] = await Promise.all([
    prisma.store.findUniqueOrThrow({ where: { id: storeId } }),
    prisma.recommendation.findMany({ where: { storeId, status: "OPEN" }, include: { product: true } }),
    prisma.product.findMany({ where: { storeId }, include: { variants: true, reviews: true, salesSnapshots: { take: 1 } } }),
    prisma.salesSnapshot.count({ where: { product: { storeId } } }),
  ]);

  const stock = products.flatMap((p) =>
    p.variants.map((v) => {
      const input: StockInput = {
        productId: p.id,
        variantId: v.id,
        title: p.title,
        sku: v.sku,
        storeStock: v.inventoryQuantity,
        supplierStock: v.supplierStock,
        unitsSoldLast30Days: null,
        lastSyncedAt: v.updatedAt.toISOString(),
      };
      return analyzeStock(input);
    }),
  );

  const productsWithoutReviews = products.filter((p) => p.reviews.length === 0).map((p) => ({ productId: p.id, title: p.title }));

  // LOT 10 — contexte produit courant, résolu UNE SEULE FOIS ici, jamais
  // recalculé avec une seconde formule : mêmes modules purs que la fiche
  // Product Intelligence (lot 9). `findFirst` avec `storeId` (pas
  // `findUnique` sur l'id seul) — un id transmis par le client pour une
  // AUTRE boutique ne doit jamais renvoyer de données (isolation multi-tenant).
  let pageProduct: PageProductContext | null = null;
  if (contextProductId) {
    const product = await prisma.product.findFirst({
      where: { id: contextProductId, storeId },
      include: { variants: true, costAssumption: true, scoreSnapshots: { orderBy: { computedAt: "desc" }, take: 1 } },
    });
    if (product) {
      const scoreBreakdown = product.scoreSnapshots[0]
        ? (JSON.parse(product.scoreSnapshots[0].factorsJson) as { score: number; dataCompleteness: number })
        : null;

      const marginGatedByPlan = !hasFeature(plan, "pricing");
      let costedVariants = 0;
      let avgMarginRatePct: number | null = null;
      if (!marginGatedByPlan) {
        const storeCostDefaults = await prisma.store.findUnique({
          where: { id: storeId },
          select: { defaultShippingCost: true, defaultPaymentFeesRate: true },
        });
        const analyses = product.variants.map((v) => {
          const costs = resolveCostInputs(v, product.costAssumption, storeCostDefaults);
          return analyzeMargin({
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
        });
        const summary = summarizeGrossMargin(analyses);
        costedVariants = summary.withRealCost + summary.withFallbackCost;
        avgMarginRatePct = summary.averageGrossRate !== null ? summary.averageGrossRate * 100 : null;
      }

      const anyStockKnown = product.variants.some((v) => v.inventoryQuantity !== null);
      const stockTotal = anyStockKnown ? product.variants.reduce((s, v) => s + (v.inventoryQuantity ?? 0), 0) : null;

      const since = new Date(Date.now() - CONTEXT_PRODUCT_WINDOW_DAYS * 2 * 24 * 60 * 60 * 1000);
      const salesSnapshots = await prisma.salesSnapshot.findMany({
        where: { productId: product.id, date: { gte: since } },
        select: { date: true, unitsSold: true, revenue: true },
      });
      const salesRows: ProductSalesRow[] = salesSnapshots;
      const now = new Date();
      const currentStart = new Date(now.getTime() - CONTEXT_PRODUCT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
      const previousStart = new Date(now.getTime() - CONTEXT_PRODUCT_WINDOW_DAYS * 2 * 24 * 60 * 60 * 1000);
      const currentWindow = aggregateProductSalesWindow(salesRows, currentStart, now);
      const previousWindow = aggregateProductSalesWindow(salesRows, previousStart, currentStart);
      const salesTrend = computeProductSalesTrend(currentWindow, previousWindow, CONTEXT_PRODUCT_WINDOW_DAYS);

      pageProduct = {
        id: product.id,
        title: product.title,
        score: scoreBreakdown?.score ?? null,
        dataCompleteness: scoreBreakdown?.dataCompleteness ?? null,
        marginGatedByPlan,
        costedVariants,
        totalVariants: product.variants.length,
        avgMarginRatePct,
        stockTotal,
        salesWindowDays: CONTEXT_PRODUCT_WINDOW_DAYS,
        salesUnitsSold: currentWindow.unitsSold,
        salesRevenue: currentWindow.revenue,
        salesTrendLabel: salesTrend.label,
      };
    }
    // Produit introuvable ou d'une autre boutique : `pageProduct` reste
    // `null` — l'intention "current_product_summary" répond alors
    // honnêtement qu'aucune fiche produit n'est en contexte, jamais une
    // erreur qui ferait planter la question.
  }

  const ctx: AssistantContext = {
    recommendations: recommendations.map((r) => ({
      id: r.id,
      category: r.category,
      severity: r.severity,
      title: r.title,
      reason: r.reason,
      impact: r.impact,
      confidence: r.confidence,
      actionLabel: r.actionLabel,
      actionType: r.actionType,
      productId: r.productId,
      productTitle: r.product?.title ?? null,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
    })),
    stock,
    productsWithoutReviews,
    salesTrendAvailable: salesCount > 0,
    storeName: store.name,
    pageProduct,
  };

  const answer = await answerQuestion(question, ctx);

  // MINIMISATION (audit conformité 05/09/2026) — le texte libre de la
  // question n'est plus persisté ici : il peut contenir une donnée
  // personnelle qu'un marchand aurait collée par inadvertance, et ce journal
  // est visible par toute l'équipe de l'organisation (page /audit-log), sans
  // durée de rétention. Seule l'intention détectée (enum fermé) et la
  // longueur de la question sont conservées — suffisant pour la traçabilité
  // fonctionnelle, sans reconstituer le contenu exact tapé par l'utilisateur.
  await logAudit({
    storeId,
    userId,
    actorType: "user",
    event: "assistant.query",
    message: `Question posée à l'assistant (intention détectée : ${answer.matchedIntent ?? "aucune"}, ${question.length} caractère(s)).`,
  });

  return NextResponse.json(answer);
}
