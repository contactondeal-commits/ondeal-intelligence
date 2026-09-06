import { NextRequest, NextResponse } from "next/server";
import { CapabilityError, requireCapability } from "@/lib/authz/capabilities";
import { getStorefrontMission, requestMissionCancellation } from "@/lib/ai/supervisor/graphStore";
import { appendAuditLog } from "@/lib/ai/policy/audit";

/** ONDEAL AI CORE — PHASE 5 : Kill Switch par mission (§"Real-Time Controls") — coopératif, jamais une coupure forcée. */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let userId: string;
  try {
    ({ userId } = await requireCapability("SYSTEM_CODER"));
  } catch (err) {
    if (err instanceof CapabilityError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }

  const mission = await getStorefrontMission(id);
  if (!mission) return NextResponse.json({ error: "Mission introuvable." }, { status: 404 });

  await requestMissionCancellation(id);
  await appendAuditLog({ missionId: id, actorUserId: userId, action: "mission_cancel_requested", reason: "Annulation demandée par l'Owner — coopérative, prendra effet à la prochaine itération de la boucle du graphe.", resultStatus: "SUCCESS" });

  return NextResponse.json({ ok: true });
}
