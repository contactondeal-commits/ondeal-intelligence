import { NextResponse } from "next/server";
import { CapabilityError, requireCapabilityWithStepUp } from "@/lib/authz/capabilities";
import { OwnerAuthError } from "@/lib/authz/ownerSession";
import { disconnectGithub } from "@/lib/ai/connectors/github";
import { appendAuditLog } from "@/lib/ai/policy/audit";

export async function POST() {
  let userId: string;
  try {
    ({ userId } = await requireCapabilityWithStepUp("SYSTEM_CODER"));
  } catch (err) {
    if (err instanceof CapabilityError || err instanceof OwnerAuthError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }
  await disconnectGithub();
  await appendAuditLog({ actorUserId: userId, connectorId: "github", action: "connector_disconnect", reason: "Connecteur GitHub déconnecté par l'Owner.", resultStatus: "SUCCESS" });
  return NextResponse.json({ ok: true });
}
