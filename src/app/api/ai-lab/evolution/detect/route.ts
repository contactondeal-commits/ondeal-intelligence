import { NextResponse } from "next/server";
import { CapabilityError, requireCapabilityWithOwnerSession } from "@/lib/authz/capabilities";
import { OwnerAuthError } from "@/lib/authz/ownerSession";
import { detectAndPersistSignals } from "@/lib/ai/evolution/proposals";
import { appendAuditLog } from "@/lib/ai/policy/audit";

/**
 * ONDEAL AI CORE — §61-65 "System Evolution Console" (06/09/2026).
 *
 * Scan MÉCANIQUE (jamais un signal inventé, voir proposals.ts::detectSignals)
 * déclenché explicitement par l'Owner (un clic "Analyser les signaux") —
 * jamais un cron autonome qui ferait tourner ce scan sans que l'Owner l'ait
 * demandé (§"AI self-promotion impossible" : même l'ACTE de chercher un
 * signal reste une action Owner-initiée).
 */
export async function POST() {
  let userId: string;
  try {
    ({ userId } = await requireCapabilityWithOwnerSession("SYSTEM_CODER"));
  } catch (err) {
    if (err instanceof CapabilityError || err instanceof OwnerAuthError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }

  const result = await detectAndPersistSignals();
  await appendAuditLog({
    actorUserId: userId,
    action: "evolution_signals_detected",
    reason: `Scan de signaux d'évolution (Agent Registry) : ${result.created} nouvelle(s) proposition(s), ${result.skippedExisting} déjà couverte(s) par une proposition ouverte.`,
    resultStatus: "SUCCESS",
  });
  return NextResponse.json(result);
}
