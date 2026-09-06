import { NextResponse } from "next/server";
import { CapabilityError, requireCapabilityWithStepUp } from "@/lib/authz/capabilities";
import { OwnerAuthError } from "@/lib/authz/ownerSession";
import { shipProposal } from "@/lib/ai/evolution/proposals";
import { appendAuditLog } from "@/lib/ai/policy/audit";

/**
 * ONDEAL AI CORE — §61-65 "System Evolution Console" (06/09/2026).
 *
 * L'UNIQUE écriture externe de tout ce pipeline : crée réellement une
 * branche + des commits (via l'API Contents GitHub) + une Pull Request sur
 * le dépôt réel OnDeal Intelligence — jamais depuis un fichier
 * `supervisor/*.ts`. Step-up requis (EXTERNAL_WRITE, jamais ALLOW_AUTO,
 * §"Owner Sovereignty") ; exige en amont qu'un humain ait déjà APPROVED la
 * proposition (voir reviewProposal) — cette route ne fait qu'exécuter une
 * décision déjà prise, jamais sa propre décision.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let userId: string;
  try {
    ({ userId } = await requireCapabilityWithStepUp("SYSTEM_CODER"));
  } catch (err) {
    if (err instanceof CapabilityError || err instanceof OwnerAuthError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }
  const { id } = await params;
  try {
    const { proposal, ship } = await shipProposal({ proposalId: id, userId });
    await appendAuditLog({
      actorUserId: userId,
      action: "evolution_proposal_shipped",
      reason: `EvolutionProposal ${id} livrée : Pull Request réelle ouverte (${ship.prUrl}), branche "${ship.branch}", ${ship.changedFiles.length} fichier(s) modifié(s).`,
      resultStatus: "SUCCESS",
    });
    return NextResponse.json({ proposal, ship });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await appendAuditLog({ actorUserId: userId, action: "evolution_proposal_shipped", reason: `Échec de livraison pour ${id} : ${message}`, resultStatus: "FAILURE" });
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
