import { NextRequest, NextResponse } from "next/server";
import { CapabilityError, requireCapability } from "@/lib/authz/capabilities";
import { listAuditLogs } from "@/lib/ai/policy/audit";

/** ONDEAL AI CORE — PHASE 5 : Audit Trail global (§13, Owner Control Center). */
export async function GET(req: NextRequest) {
  try {
    await requireCapability("SYSTEM_CODER");
  } catch (err) {
    if (err instanceof CapabilityError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }
  const missionId = req.nextUrl.searchParams.get("missionId") ?? undefined;
  const logs = await listAuditLogs({ missionId, take: 200 });
  return NextResponse.json({ logs });
}
