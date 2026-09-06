import { NextResponse } from "next/server";
import { CapabilityError, requireCapabilityWithOwnerSession } from "@/lib/authz/capabilities";
import { OwnerAuthError } from "@/lib/authz/ownerSession";
import { launchProposalMission } from "@/lib/ai/evolution/proposals";
import { appendAuditLog } from "@/lib/ai/policy/audit";

/**
 * ONDEAL AI CORE — §61-65 "System Evolution Console" (06/09/2026).
 * Crée une VRAIE CoderMission (Phase 3) — la ligne QUEUED existe désormais
 * en base, comme n'importe quelle mission créée via /api/coder-missions.
 * L'EXÉCUTION réelle reste hors Vercel (voir scripts/run-coder-mission.ts /
 * le dispatch GitHub Actions déjà existant pour le Coder Agent) — même
 * frontière honnête "DEV PROOF vs PRODUCT RUNTIME" documentée depuis Phase 3.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let userId: string;
  try {
    ({ userId } = await requireCapabilityWithOwnerSession("SYSTEM_CODER"));
  } catch (err) {
    if (err instanceof CapabilityError || err instanceof OwnerAuthError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }
  const { id } = await params;
  try {
    const { proposal, mission } = await launchProposalMission(id, userId);
    await appendAuditLog({ actorUserId: userId, action: "evolution_mission_launched", reason: `CoderMission ${mission.id} créée pour l'EvolutionProposal ${id}.`, resultStatus: "SUCCESS" });
    return NextResponse.json({ proposal, mission });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
