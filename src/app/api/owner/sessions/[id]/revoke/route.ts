import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { requireStepUp, revokeOwnerSession, OwnerAuthError } from "@/lib/authz/ownerSession";
import { appendAuditLog } from "@/lib/ai/policy/audit";

// §"session revocation" : action sensible — exige step-up (une session
// compromise mais toujours L2 ne peut pas révoquer les AUTRES sessions sans
// re-prouver sa possession de la clé, sinon un vol de cookie suffirait).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: sessionId } = await params;
  const current = await getCurrentUser();
  if (!current) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });

  try {
    await requireStepUp(current.user.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: err instanceof OwnerAuthError ? 403 : 400 });
  }

  const revoked = await revokeOwnerSession(current.user.id, sessionId, "Révoquée manuellement par le Platform Owner depuis /ai-lab.");
  await appendAuditLog({
    actorUserId: current.user.id,
    action: "owner.session_revoked",
    reason: revoked ? `Session Owner ${sessionId} révoquée.` : `Tentative de révocation d'une session Owner introuvable/déjà révoquée (${sessionId}).`,
    resultStatus: revoked ? "SUCCESS" : "FAILURE",
  });

  if (!revoked) return NextResponse.json({ error: "Session introuvable ou déjà révoquée." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
