import { NextRequest, NextResponse } from "next/server";
import { CapabilityError, requireCapability } from "@/lib/authz/capabilities";
import { listToolsWithHealth } from "@/lib/ai/tools/registry";

/** ONDEAL AI CORE — PHASE 5 : Tool Registry avec health check RÉEL (§"AI LAB → TOOLS"). */
export async function GET(req: NextRequest) {
  try {
    await requireCapability("SYSTEM_CODER");
  } catch (err) {
    if (err instanceof CapabilityError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }
  const storeId = req.nextUrl.searchParams.get("storeId") ?? undefined;
  const tools = await listToolsWithHealth({ storeId });
  return NextResponse.json({ tools });
}
