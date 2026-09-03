import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireStoreAccess, AuthError } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { recomputeStoreIntelligence } from "@/lib/intelligence/pipeline";

const schema = z.object({
  storeId: z.string(),
  productId: z.string(),
  supplierCost: z.number().nullable(),
  shippingCost: z.number().nullable(),
  paymentFeesRate: z.number().nullable(),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Payload invalide." }, { status: 400 });

  try {
    const { userId } = await requireStoreAccess(parsed.data.storeId);

    await prisma.costAssumption.upsert({
      where: { productId: parsed.data.productId },
      create: {
        storeId: parsed.data.storeId,
        productId: parsed.data.productId,
        supplierCost: parsed.data.supplierCost,
        shippingCost: parsed.data.shippingCost,
        paymentFeesRate: parsed.data.paymentFeesRate,
      },
      update: {
        supplierCost: parsed.data.supplierCost,
        shippingCost: parsed.data.shippingCost,
        paymentFeesRate: parsed.data.paymentFeesRate,
      },
    });

    await logAudit({
      storeId: parsed.data.storeId,
      userId,
      actorType: "user",
      event: "cost_assumption.updated",
      message: `Hypothèses de coût mises à jour pour un produit.`,
      meta: { productId: parsed.data.productId },
    });

    // Recalcule marge/score/recommandations avec les nouvelles hypothèses.
    await recomputeStoreIntelligence(parsed.data.storeId);

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }
}
