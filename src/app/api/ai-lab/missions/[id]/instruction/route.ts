import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { CapabilityError, requireCapabilityWithOwnerSession } from "@/lib/authz/capabilities";
import { OwnerAuthError } from "@/lib/authz/ownerSession";
import { getStorefrontMission, submitPendingInstruction } from "@/lib/ai/supervisor/graphStore";
import { appendAuditLog } from "@/lib/ai/policy/audit";

/**
 * ONDEAL AI CORE — §10 "ADD INSTRUCTION DURING MISSION" (06/09/2026), clôture réelle.
 *
 * Écrit RÉELLEMENT `StorefrontMission.pendingInstruction` — consommée par
 * graphRunner.ts à la prochaine itération de la boucle (généralement <60s,
 * voir le heartbeat des nodes en cours), jamais un champ décoratif jamais lu.
 * Route Owner-gated (session WebAuthn valide) — pas de step-up complet ici :
 * ajouter une instruction ne fait qu'orienter le travail, elle ne déclenche
 * aucun effet irréversible par elle-même (le node "coder_implementation"
 * qu'elle pourrait produire reste, lui, gardé par le Policy Engine
 * SANDBOX_EFFECT existant — voir graphRunner.ts).
 */
const bodySchema = z.object({ text: z.string().trim().min(3).max(4000) }).strict();

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Paramètres invalides.", details: parsed.error.flatten() }, { status: 400 });

  let userId: string;
  try {
    ({ userId } = await requireCapabilityWithOwnerSession("SYSTEM_CODER"));
  } catch (err) {
    if (err instanceof CapabilityError || err instanceof OwnerAuthError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }

  const mission = await getStorefrontMission(id);
  if (!mission) return NextResponse.json({ error: "Mission introuvable." }, { status: 404 });

  try {
    await submitPendingInstruction(id, parsed.data.text);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Échec de la soumission de l'instruction.";
    return NextResponse.json({ error: message }, { status: 409 });
  }

  await appendAuditLog({ missionId: id, actorUserId: userId, action: "instruction_submitted", reason: `Instruction soumise par l'Owner, en attente de consommation par la boucle : "${parsed.data.text}"`, resultStatus: "SUCCESS" });
  return NextResponse.json({ ok: true, detail: "Instruction enregistrée — elle sera prise en compte à la prochaine itération de la boucle du graphe (généralement en moins d'une minute pendant l'exécution)." });
}
