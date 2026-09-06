import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { CapabilityError, requireCapability } from "@/lib/authz/capabilities";
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
    throw err;
  }
  const policy = await getSystemPolicy();
  return NextResponse.json({ policy });
}

export async function PATCH(req: NextRequest) {
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Paramètres invalides.", details: parsed.error.flatten() }, { status: 400 });

  let userId: string;
  try {
    ({ userId } = await requireCapability("SYSTEM_CODER"));
  } catch (err) {
    if (err instanceof CapabilityError) return NextResponse.json({ error: err.message }, { status: 403 });
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
