import { NextRequest, NextResponse } from "next/server";
import { CapabilityError, requireCapability } from "@/lib/authz/capabilities";
import { listConnectorsWithHealth } from "@/lib/ai/connectors/registry";

/** ONDEAL AI CORE — PHASE 5 : Connector Registry (§"AI LAB → CONNECTORS", §"NO FAKE CONNECTOR"). */
export async function GET(req: NextRequest) {
  try {
    await requireCapability("SYSTEM_CODER");
  } catch (err) {
    if (err instanceof CapabilityError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }
  const storeId = req.nextUrl.searchParams.get("storeId") ?? undefined;
  const connectors = await listConnectorsWithHealth({ storeId });
  return NextResponse.json({ connectors });
}
