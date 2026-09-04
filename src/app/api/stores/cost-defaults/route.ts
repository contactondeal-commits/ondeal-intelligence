import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireStoreAccess, AuthError } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { recomputeStoreIntelligence } from "@/lib/intelligence/pipeline";

// HYPOTHÈSES boutique (transport moyen, taux de frais de paiement) — jamais
// des données Shopify. Utilisées en repli des CostAssumption produit pour
// rendre la marge complète calculable sur tout le catalogue à partir du
// coût réel Shopify. Étiquetées "estimées" partout où elles apparaissent.
const schema = z.object({
  storeId: z.string(),
  defaultShippingCost: z.number().min(0).nullable(),
  defaultPaymentFeesRate: z.number().min(0).max(1).nullable(),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Payload invalide." }, { status: 400 });

  try {
    const { userId } = await requireStoreAccess(parsed.data.storeId);
    await prisma.store.update({
      where: { id: parsed.data.storeId },
      data: { defaultShippingCost: parsed.data.defaultShippingCost, defaultPaymentFeesRate: parsed.data.defaultPaymentFeesRate },
    });
    await logAudit({
      storeId: parsed.data.storeId,
      userId,
      actorType: "user",
      event: "cost_defaults.updated",
      message: `Hypothèses boutique mises à jour : transport ${parsed.data.defaultShippingCost ?? "—"} €, frais de paiement ${
        parsed.data.defaultPaymentFeesRate !== null ? (parsed.data.defaultPaymentFeesRate * 100).toFixed(2) + "%" : "—"
      }.`,
    });
    await recomputeStoreIntelligence(parsed.data.storeId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }
}
