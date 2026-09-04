import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireStoreAccess, requireRole, WRITE_ROLES, AuthError } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { recomputeStoreIntelligence } from "@/lib/intelligence/pipeline";

const schema = z.object({
  storeId: z.string().min(1).max(64),
  productId: z.string().min(1).max(64),
  supplierCost: z.number().min(0).max(1_000_000).nullable(),
  shippingCost: z.number().min(0).max(100_000).nullable(),
  paymentFeesRate: z.number().min(0).max(1).nullable(),
}).strict();

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Payload invalide." }, { status: 400 });

  try {
    const { userId, role } = await requireStoreAccess(parsed.data.storeId);
    requireRole(role, WRITE_ROLES);

    // Isolation multi-boutiques : le produit doit appartenir à la boutique
    // dont l'accès vient d'être vérifié (sinon un membre d'une autre
    // organisation pourrait écraser les hypothèses de coût d'un tiers).
    const product = await prisma.product.findUnique({ where: { id: parsed.data.productId }, select: { storeId: true } });
    if (!product || product.storeId !== parsed.data.storeId) {
      return NextResponse.json({ error: "Produit introuvable pour cette boutique." }, { status: 404 });
    }

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
