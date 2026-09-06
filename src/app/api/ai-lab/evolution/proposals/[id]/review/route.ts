import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { CapabilityError, requireCapabilityWithStepUp } from "@/lib/authz/capabilities";
import { OwnerAuthError } from "@/lib/authz/ownerSession";
import { reviewProposal } from "@/lib/ai/evolution/proposals";
import { appendAuditLog } from "@/lib/ai/policy/audit";

/**
 * ONDEAL AI CORE — §61-65 "System Evolution Console" (06/09/2026).
 * Décision Owner (APPROVE/REJECT) sur une proposition dont la CoderMission
 * liée est terminée — step-up requis : approuver un changement de CODE du
 * système lui-même est exactement le type de décision que §"Owner
 * Sovereignty" réserve à une ré-preuve de possession de clé récente.
 */
const bodySchema = z.object({ decision: z.enum(["APPROVE", "REJECT"]), note: z.string().max(2000).optional() }).strict();

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Paramètres invalides.", details: parsed.error.flatten() }, { status: 400 });

  let userId: string;
  try {
    ({ userId } = await requireCapabilityWithStepUp("SYSTEM_CODER"));
  } catch (err) {
    if (err instanceof CapabilityError || err instanceof OwnerAuthError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }
  const { id } = await params;
  try {
    const proposal = await reviewProposal({ proposalId: id, userId, decision: parsed.data.decision, note: parsed.data.note });
    await appendAuditLog({
      actorUserId: userId,
      action: "evolution_proposal_reviewed",
      reason: `EvolutionProposal ${id} ${parsed.data.decision === "APPROVE" ? "APPROUVÉE" : "REJETÉE"} par l'Owner.${parsed.data.note ? ` Note : ${parsed.data.note}` : ""}`,
      resultStatus: "SUCCESS",
    });
    return NextResponse.json({ proposal });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
