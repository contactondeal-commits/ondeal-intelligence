import { NextResponse } from "next/server";
import { CapabilityError, requireCapability } from "@/lib/authz/capabilities";
import { listModelConsole } from "@/lib/ai/models/registry";

/** ONDEAL AI CORE — PHASE 5 : Model Console en lecture (§"AI LAB → MODELS"). */
export async function GET() {
  try {
    await requireCapability("SYSTEM_CODER");
  } catch (err) {
    if (err instanceof CapabilityError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }
  const models = await listModelConsole();
  return NextResponse.json({ models });
}
