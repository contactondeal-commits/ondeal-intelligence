import { NextResponse } from "next/server";
import { CapabilityError, requireCapabilityWithOwnerSession } from "@/lib/authz/capabilities";
import { OwnerAuthError } from "@/lib/authz/ownerSession";
import { listAgentRegistry } from "@/lib/ai/agents/registry";

/** ONDEAL AI CORE — §14 "Dynamic Agent Registry" (06/09/2026) — AI LAB → AGENTS. */
export async function GET() {
  try {
    await requireCapabilityWithOwnerSession("AI_EVAL_READ");
  } catch (err) {
    if (err instanceof CapabilityError || err instanceof OwnerAuthError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }
  return NextResponse.json({ agents: await listAgentRegistry() });
}
