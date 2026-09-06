import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { requireOwnerSession, OwnerAuthError } from "@/lib/authz/ownerSession";
import { buildAuthenticationOptions } from "@/lib/authz/webauthn";

// §"step-up authentication" : exige déjà une session Owner L2 valide avant
// même d'émettre le challenge d'élévation — jamais accessible sans passkey préalable.
export async function POST() {
  const current = await getCurrentUser();
  if (!current) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  try {
    await requireOwnerSession(current.user.id);
    const options = await buildAuthenticationOptions(current.user.id, "STEP_UP");
    return NextResponse.json(options);
  } catch (err) {
    const status = err instanceof OwnerAuthError ? 403 : 400;
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status });
  }
}
