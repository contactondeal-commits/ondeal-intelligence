import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireStoreAccess, AuthError } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

// PHASE 13 — étape de validation humaine explicite, distincte de l'exécution.
// "Cette action va modifier votre boutique." → Annuler / Confirmer.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const action = await prisma.actionItem.findUnique({ where: { id } });
  if (!action) return NextResponse.json({ error: "Action introuvable." }, { status: 404 });

  const body = await req.json().catch(() => ({}));

  try {
    const { userId } = await requireStoreAccess(action.storeId);
    if (action.status !== "PENDING_VALIDATION") {
      return NextResponse.json({ error: `Action déjà au statut ${action.status}.` }, { status: 409 });
    }

    // Pour les actions de type "update_price" / "update_stock", le nouveau
    // prix/stock est saisi par l'humain au moment de la validation — jamais
    // décidé automatiquement par le moteur de recommandations.
    const existingPayload = JSON.parse(action.payloadJson) as Record<string, unknown>;
    const mergedPayload = { ...existingPayload, ...(body?.params ?? {}) };

    const updated = await prisma.actionItem.update({
      where: { id },
      data: { status: "CONFIRMED", confirmedAt: new Date(), payloadJson: JSON.stringify(mergedPayload) },
    });
    await logAudit({
      storeId: action.storeId,
      userId,
      actorType: "user",
      event: "action.confirmed",
      message: `Action confirmée par l'utilisateur (type: ${action.type}).`,
      meta: { actionId: id },
    });
    return NextResponse.json({ ok: true, action: updated });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }
}
