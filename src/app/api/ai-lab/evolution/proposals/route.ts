import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { CapabilityError, requireCapabilityWithOwnerSession } from "@/lib/authz/capabilities";
import { OwnerAuthError } from "@/lib/authz/ownerSession";
import { createOwnerProposal, listProposals } from "@/lib/ai/evolution/proposals";
import { appendAuditLog } from "@/lib/ai/policy/audit";

/**
 * ONDEAL AI CORE — §61-65 "System Evolution Console" (06/09/2026).
 * GET : liste des EvolutionProposal (statut synchronisé en lecture depuis la
 * CoderMission liée — jamais un statut mis en cache).
 * POST : l'Owner écrit lui-même une hypothèse (source="OWNER") — gate
 * SYSTEM_CODER (même capacité que /api/coder-missions, dont ce pipeline est
 * une extension) mais PAS de step-up : écrire une proposition n'exécute
 * encore rien (aucun code modifié à ce stade — voir /launch et /ship).
 */
const bodySchema = z.object({ hypothesis: z.string().min(1).max(4000), targetArea: z.string().min(1).max(200) }).strict();

export async function GET() {
  try {
    await requireCapabilityWithOwnerSession("AI_EVAL_READ");
  } catch (err) {
    if (err instanceof CapabilityError || err instanceof OwnerAuthError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }
  const proposals = await listProposals(50);
  return NextResponse.json({ proposals });
}

export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Paramètres invalides.", details: parsed.error.flatten() }, { status: 400 });

  let userId: string;
  try {
    ({ userId } = await requireCapabilityWithOwnerSession("SYSTEM_CODER"));
  } catch (err) {
    if (err instanceof CapabilityError || err instanceof OwnerAuthError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }

  const proposal = await createOwnerProposal({ hypothesis: parsed.data.hypothesis, targetArea: parsed.data.targetArea, userId });
  await appendAuditLog({ actorUserId: userId, action: "evolution_proposal_created", reason: `Proposition d'évolution créée par l'Owner sur "${parsed.data.targetArea}".`, resultStatus: "SUCCESS" });
  return NextResponse.json({ proposal }, { status: 201 });
}
