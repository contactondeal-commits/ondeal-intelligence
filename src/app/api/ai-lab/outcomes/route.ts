import { NextResponse } from "next/server";
import { CapabilityError, requireCapabilityWithOwnerSession } from "@/lib/authz/capabilities";
import { OwnerAuthError } from "@/lib/authz/ownerSession";
import { computeOutcomeSummary } from "@/lib/ai/outcomes/engine";

/**
 * ONDEAL AI CORE — FINAL PHASE : Outcome/ROI Engine (06/09/2026) — AI LAB → OUTCOMES.
 *
 * Lecture seule, même gate que /memory et /agents (AI_EVAL_READ +
 * PlatformOwnerSession) — cette route n'écrit jamais rien, elle agrège
 * uniquement des tables déjà écrites ailleurs (voir engine.ts).
 */
export async function GET() {
  try {
    await requireCapabilityWithOwnerSession("AI_EVAL_READ");
  } catch (err) {
    if (err instanceof CapabilityError || err instanceof OwnerAuthError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }

  const summary = await computeOutcomeSummary();
  return NextResponse.json({ summary });
}
