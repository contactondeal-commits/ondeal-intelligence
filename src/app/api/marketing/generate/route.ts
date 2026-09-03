import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireStoreAccess, AuthError } from "@/lib/auth";
import { generateMarketingContent, type ContentFormat, type MarketingProductInput } from "@/lib/intelligence/marketing";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const { storeId, productId, format } = body ?? {};
  if (!storeId || !productId || !format) return NextResponse.json({ error: "Champs manquants." }, { status: 400 });

  try {
    await requireStoreAccess(storeId);
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }

  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: { variants: true, reviews: true, scoreSnapshots: { orderBy: { computedAt: "desc" }, take: 1 } },
  });
  if (!product || product.storeId !== storeId) return NextResponse.json({ error: "Produit introuvable." }, { status: 404 });

  const variant = product.variants[0];
  const avgRating = product.reviews.length > 0 ? product.reviews.reduce((s, r) => s + r.rating, 0) / product.reviews.length : null;

  const input: MarketingProductInput = {
    productId: product.id,
    title: product.title,
    productType: product.productType,
    price: variant?.price ?? null,
    compareAtPrice: variant?.compareAtPrice ?? null,
    marginRate: null,
    averageRating: avgRating,
    reviewCount: product.reviews.length,
    score: product.scoreSnapshots[0]?.score ?? 0,
    daysOfStock: null,
  };

  const result = generateMarketingContent(input, format as ContentFormat);
  return NextResponse.json({ ok: true, result });
}
