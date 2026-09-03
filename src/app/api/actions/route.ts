import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireStoreAccess, AuthError } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

// Types d'action sensibles (PHASE 13/PHASE 18) — nécessitent toujours une
// confirmation humaine explicite avant exécution, quel que soit le plan ou
// le rôle de l'utilisateur.
const SENSITIVE_ACTION_TYPES = new Set(["update_price", "update_stock", "unpublish_product", "publish_product"]);

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const { storeId, recommendationId } = body ?? {};
  if (!storeId || !recommendationId) return NextResponse.json({ error: "storeId et recommendationId requis." }, { status: 400 });

  try {
    const { userId } = await requireStoreAccess(storeId);

    const rec = await prisma.recommendation.findUnique({ where: { id: recommendationId } });
    if (!rec || rec.storeId !== storeId) return NextResponse.json({ error: "Recommandation introuvable." }, { status: 404 });
    if (!rec.actionType) return NextResponse.json({ error: "Cette recommandation n'a pas d'action exécutable." }, { status: 400 });

    const sensitivity = SENSITIVE_ACTION_TYPES.has(rec.actionType) ? "SENSITIVE" : "SAFE";

    const action = await prisma.actionItem.create({
      data: {
        storeId,
        recommendationId,
        type: rec.actionType,
        sensitivity,
        status: "PENDING_VALIDATION",
        payloadJson: rec.actionPayloadJson ?? "{}",
        createdByUserId: userId,
      },
    });

    await logAudit({
      storeId,
      userId,
      actorType: "user",
      event: "action.prepared",
      message: `Action préparée : "${rec.title}" (${rec.actionType}). En attente de validation.`,
      meta: { actionId: action.id },
    });

    return NextResponse.json({ ok: true, actionId: action.id });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }
}
