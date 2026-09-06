import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { CapabilityError, requireCapability, requireCapabilityWithStepUp } from "@/lib/authz/capabilities";
import { OwnerAuthError } from "@/lib/authz/ownerSession";
import { getSystemPolicy, setSystemPolicy } from "@/lib/ai/policy/engine";
import { appendAuditLog } from "@/lib/ai/policy/audit";

/**
 * ONDEAL AI CORE — PHASE 5 : Owner Control Center — Policy/Kill Switch
 * (06/09/2026), §9/§17. SEULE route qui écrit SystemPolicy — voir
 * policy/engine.ts::setSystemPolicy. Un bouton "Kill Switch" côté frontend
 * appelle PATCH avec {killSwitchEngaged:true} — effet réel dès la PROCHAINE
 * itération de CHAQUE mission en cours (graphRunner.ts vérifie à chaque
 * tour), jamais un affichage décoratif.
 */
const patchSchema = z
  .object({
    killSwitchEngaged: z.boolean().optional(),
    killSwitchReason: z.string().max(500).nullable().optional(),
    defaultAutonomyLevel: z.enum(["ASSIST", "AUTONOMOUS", "DEEP", "ULTIMATE"]).optional(),
    maxHardBudgetUsdGlobal: z.number().positive().max(10_000).optional(),
    productionEffectsAllowed: z.boolean().optional(),
  })
  .strict();

export async function GET() {
  try {
    await requireCapability("SYSTEM_CODER");
  } catch (err) {
    if (err instanceof CapabilityError) return NextResponse.json({ error: err.message }, { status: 403 });
    if (err instanceof OwnerAuthError) return NextResponse.json({ error: err.message, code: err.code }, { status: 403 });
    throw err;
  }
  const policy = await getSystemPolicy();
  return NextResponse.json({ policy });
}

export async function PATCH(req: NextRequest) {
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Paramètres invalides.", details: parsed.error.flatten() }, { status: 400 });

  // §"Kill Switch Owner" / §"sensitive-action gates" (06/09/2026) : toute
  // écriture de SystemPolicy — kill switch INCLUS — exige une session Owner
  // RÉÉLEVÉE (step-up WebAuthn < 5 min), jamais seulement une session L2
  // "juste ouverte". Une session volée sans la clé physique ne suffit pas.
  let userId: string;
  try {
    ({ userId } = await requireCapabilityWithStepUp("SYSTEM_CODER"));
  } catch (err) {
    if (err instanceof CapabilityError) return NextResponse.json({ error: err.message }, { status: 403 });
    if (err instanceof OwnerAuthError) return NextResponse.json({ error: err.message, code: err.code }, { status: 403 });
    throw err;
  }

  const policy = await setSystemPolicy(parsed.data, userId);
  await appendAuditLog({
    actorUserId: userId,
    action: "policy_update",
    reason: `SystemPolicy modifiée par l'Owner : ${JSON.stringify(parsed.data)}.`,
    resultStatus: "SUCCESS",
  });

  return NextResponse.json({ policy });
}
