import { NextResponse } from "next/server";
import { CapabilityError, requireCapabilityWithOwnerSession } from "@/lib/authz/capabilities";
import { OwnerAuthError } from "@/lib/authz/ownerSession";
import { computeObservabilitySummary } from "@/lib/observability/engine";

/**
 * ONDEAL AI CORE — FINAL PHASE : Observabilité réelle (06/09/2026), volet
 * Owner Cockpit. Même gate que /api/ai-lab/outcomes (AI_EVAL_READ, lecture
 * pure, aucune mutation) — jamais un raccourci Merchant Plane : la santé
 * opérationnelle de la plateforme entière n'est pas une donnée de boutique.
 */
export async function GET() {
  try {
    await requireCapabilityWithOwnerSession("AI_EVAL_READ");
  } catch (err) {
    if (err instanceof CapabilityError || err instanceof OwnerAuthError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }
  const summary = await computeObservabilitySummary();
  return NextResponse.json({ summary });
}
