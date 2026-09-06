import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { requireOwnerSession, elevateToStepUp, OwnerAuthError } from "@/lib/authz/ownerSession";
import { verifyAuthentication } from "@/lib/authz/webauthn";
import { appendAuditLog } from "@/lib/ai/policy/audit";

const bodySchema = z.object({ response: z.unknown() }).strict();

export async function POST(req: NextRequest) {
  const current = await getCurrentUser();
  if (!current) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Paramètres invalides." }, { status: 400 });

  try {
    const { sessionId } = await requireOwnerSession(current.user.id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await verifyAuthentication(current.user.id, parsed.data.response as any, "STEP_UP");
    await elevateToStepUp(sessionId);
    await appendAuditLog({ actorUserId: current.user.id, action: "owner.step_up_granted", reason: "Élévation step-up WebAuthn réussie — valide 5 minutes.", resultStatus: "SUCCESS" });
    return NextResponse.json({ ok: true, expiresInSeconds: 300 });
  } catch (err) {
    const status = err instanceof OwnerAuthError ? 403 : 400;
    const message = err instanceof Error ? err.message : String(err);
    await appendAuditLog({ actorUserId: current.user.id, action: "owner.step_up_failed", reason: message, resultStatus: "FAILURE" });
    return NextResponse.json({ error: message }, { status });
  }
}
