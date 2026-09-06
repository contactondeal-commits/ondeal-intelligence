import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, requireStoreAccess } from "@/lib/auth";
import { CapabilityError, requireCapability } from "@/lib/authz/capabilities";
import { logAudit } from "@/lib/audit";
import { createMission, listMissions } from "@/lib/ai/coder/missionStore";

/**
 * ONDEAL AI CORE — PHASE 3 (06/09/2026).
 *
 * CONTROL PLANE, SYSTEM CODER = PLATFORM OWNER ONLY (§13 de la commande) :
 * gate `requireCapability("SYSTEM_CODER")` — indépendant de tout rôle
 * Membership, y compris Role.OWNER d'une organisation cliente. Cette route
 * ne fait QUE créer/lister la ligne CoderMission (QUEUED) — même principe
 * que POST /api/jobs pour le Job Engine : l'EXÉCUTION réelle (workspace,
 * édition, build, navigateur) n'a jamais lieu dans une fonction serverless
 * Vercel (pas de checkout git persistant, pas de Chromium) — voir le
 * rapport de session "DEV PROOF vs PRODUCT RUNTIME" et
 * scripts/run-coder-mission.ts (l'exécuteur réel, appelé hors Vercel).
 *
 * `storeId` reste dans le corps UNIQUEMENT pour la traçabilité d'audit
 * (AuditLog.storeId est requis en base) — même workaround explicite que
 * POST /api/model-evaluations/run (PHASE 2) : `requireStoreAccess` ici ne
 * sert JAMAIS à accorder la permission Control Plane elle-même.
 */
const bodySchema = z.object({ goal: z.string().min(1).max(2000), storeId: z.string().min(1).max(64) }).strict();

export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Paramètres invalides." }, { status: 400 });
  const { goal, storeId } = parsed.data;

  let userId: string;
  try {
    const capability = await requireCapability("SYSTEM_CODER");
    userId = capability.userId;
    await requireStoreAccess(storeId); // validation du contexte d'audit uniquement — voir commentaire ci-dessus
  } catch (err) {
    if (err instanceof CapabilityError || err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }

  const mission = await createMission({ goal, createdByUserId: userId });

  await logAudit({
    storeId,
    userId,
    actorType: "user",
    event: "coder_mission.created",
    message: `Mission Coder Agent créée (${mission.id}) : ${goal.slice(0, 200)}`,
    meta: { missionId: mission.id },
  });

  return NextResponse.json({ mission: { id: mission.id, goal: mission.goal, status: mission.status, createdAt: mission.createdAt } }, { status: 201 });
}

export async function GET() {
  try {
    await requireCapability("SYSTEM_CODER");
  } catch (err) {
    if (err instanceof CapabilityError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }

  const missions = await listMissions(20);
  return NextResponse.json({
    missions: missions.map((m) => ({
      id: m.id,
      goal: m.goal,
      status: m.status,
      currentStepIndex: m.currentStepIndex,
      lastError: m.lastError,
      createdAt: m.createdAt,
      finishedAt: m.finishedAt,
    })),
  });
}
