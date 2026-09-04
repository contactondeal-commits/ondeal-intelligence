import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireStoreAccess, AuthError } from "@/lib/auth";
import { answerQuestion, type AssistantContext } from "@/lib/intelligence/assistant";
import { analyzeStock, type StockInput } from "@/lib/intelligence/stock";
import { logAudit } from "@/lib/audit";
import { z } from "zod";
import { hasFeature } from "@/lib/plan-limits";

const bodySchema = z.object({ storeId: z.string().min(1).max(64), question: z.string().trim().min(1).max(1000) }).strict();

export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Champs manquants ou invalides." }, { status: 400 });
  const { storeId, question } = parsed.data;

  let userId: string;
  try {
    ({ userId } = await requireStoreAccess(storeId));
    const plan = await prisma.store.findUnique({ where: { id: storeId }, select: { organization: { select: { plan: true } } } });
    if (!plan || !hasFeature(plan.organization.plan, "assistant")) return NextResponse.json({ error: "Module non inclus dans votre plan." }, { status: 403 });
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
  };

  const answer = await answerQuestion(question, ctx);

  await logAudit({
    storeId,
    userId,
    actorType: "user",
    event: "assistant.query",
    message: `Question posée à l'assistant : "${question}" (intention détectée : ${answer.matchedIntent ?? "aucune"}).`,
  });

  return NextResponse.json(answer);
}
