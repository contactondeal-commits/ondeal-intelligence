import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { requireOwnerSession, listOwnerSessions } from "@/lib/authz/ownerSession";
import { remainingRecoveryCodeCount } from "@/lib/authz/recovery";

// §"secure session management" : liste RÉELLE des PlatformOwnerSession de
// l'utilisateur courant, avec l'assuranceLevel effectif de chacune (recalculé
// à chaque lecture — jamais une valeur figée à la création).
export async function GET() {
  const current = await getCurrentUser();
  if (!current) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  try {
    await requireOwnerSession(current.user.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 403 });
  }
  const sessions = await listOwnerSessions(current.user.id);
  const recoveryCodesRemaining = await remainingRecoveryCodeCount(current.user.id);
  return NextResponse.json({ sessions, recoveryCodesRemaining });
}
