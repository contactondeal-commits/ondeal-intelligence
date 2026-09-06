import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { CapabilityError, requireCapabilityWithStepUp } from "@/lib/authz/capabilities";
import { OwnerAuthError } from "@/lib/authz/ownerSession";
import { setAgentRoleEnabled } from "@/lib/ai/agents/registry";
import { appendAuditLog } from "@/lib/ai/policy/audit";

/**
 * ONDEAL AI CORE — §15 "Owner Agent Control" (06/09/2026), clôture réelle.
 * Step-up requis : désactiver un rôle change immédiatement ce que TOUTE
 * mission suivante (et toute mission en cours, voir graphRunner.ts qui lit
 * ce même AgentRoleConfig à chaque itération) peut exécuter.
 */
const bodySchema = z.object({ role: z.string().min(1).max(100), enabled: z.boolean() }).strict();

export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Paramètres invalides.", details: parsed.error.flatten() }, { status: 400 });

  let userId: string;
  try {
    ({ userId } = await requireCapabilityWithStepUp("AI_MODEL_ADMIN"));
  } catch (err) {
    if (err instanceof CapabilityError || err instanceof OwnerAuthError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }

  const saved = await setAgentRoleEnabled(parsed.data.role, parsed.data.enabled, userId);
  await appendAuditLog({
    actorUserId: userId,
    action: "agent_role_config_updated",
    agentRole: parsed.data.role,
    reason: `Rôle "${parsed.data.role}" ${saved.enabled ? "réactivé" : "désactivé"} par l'Owner — effet runtime immédiat (planning et exécution en cours).`,
    resultStatus: "SUCCESS",
  });
  return NextResponse.json({ ok: true, config: saved });
}
