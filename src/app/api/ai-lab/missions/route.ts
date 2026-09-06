import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { CapabilityError, requireCapability } from "@/lib/authz/capabilities";
import { appendAuditLog } from "@/lib/ai/policy/audit";
import { getSystemPolicy } from "@/lib/ai/policy/engine";
import { createStorefrontMission, listStorefrontMissions } from "@/lib/ai/supervisor/graphStore";
import { attachToMission } from "@/lib/ai/attachments/store";
import { prisma } from "@/lib/db";

/**
 * ONDEAL AI CORE — PHASE 5 : AI Lab Ultimate — routes missions (06/09/2026).
 *
 * Même discipline que /api/coder-missions (Phase 3) : cette route ne fait
 * QUE créer la ligne (PLANNING) — l'exécution réelle se fait via
 * POST /api/ai-lab/missions/[id]/run (voir ce fichier pour la frontière
 * Vercel/dev-sandbox honnête, héritée de Phase 3/4).
 *
 * `storeId` reste OPTIONNEL (contrairement à /api/coder-missions) : une
 * mission AI Lab peut porter sur du code/recherche pur, sans boutique
 * précise (voir StorefrontMission.storeId, schema.prisma).
 */
const bodySchema = z
  .object({
    goal: z.string().min(1).max(4000),
    constraints: z.record(z.string(), z.unknown()).optional(),
    environment: z.enum(["SANDBOX", "PREVIEW", "PRODUCTION"]).default("SANDBOX"),
    autonomyLevel: z.enum(["ASSIST", "AUTONOMOUS", "DEEP", "ULTIMATE"]).default("ASSIST"),
    hardBudgetUsd: z.number().positive().max(1000).optional(),
    storeId: z.string().min(1).max(64).optional(),
    forcedModel: z.string().min(1).max(200).optional(),
    attachmentIds: z.array(z.string().min(1)).max(20).optional(),
  })
  .strict();

export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Paramètres invalides.", details: parsed.error.flatten() }, { status: 400 });
  const body = parsed.data;

  let userId: string;
  try {
    ({ userId } = await requireCapability("SYSTEM_CODER"));
  } catch (err) {
    if (err instanceof CapabilityError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }

  // §"Owner Sovereignty" (§8/§8bis) : PRODUCTION n'est JAMAIS un choix par
  // défaut, et exige explicitement que la bascule globale soit activée —
  // jamais une mission qui atteint la production parce qu'un champ de
  // formulaire a été laissé vide.
  if (body.environment === "PRODUCTION") {
    const system = await getSystemPolicy();
    if (!system.productionEffectsAllowed) {
      return NextResponse.json({ error: "Environnement PRODUCTION refusé : SystemPolicy.productionEffectsAllowed=false — bascule Owner explicite requise avant toute mission en PRODUCTION." }, { status: 403 });
    }
  }

  const mission = await createStorefrontMission({ goal: body.goal, constraints: body.constraints, createdByUserId: userId });
  await prisma.storefrontMission.update({
    where: { id: mission.id },
    data: {
      environment: body.environment,
      autonomyLevel: body.autonomyLevel,
      hardBudgetUsd: body.hardBudgetUsd ?? null,
      storeId: body.storeId ?? null,
      forcedModel: body.forcedModel ?? null,
    },
  });

  for (const attachmentId of body.attachmentIds ?? []) {
    await attachToMission(attachmentId, mission.id);
  }

  await appendAuditLog({
    missionId: mission.id,
    actorUserId: userId,
    storeId: body.storeId,
    action: "mission_create",
    reason: `Mission créée par l'Owner : "${body.goal.slice(0, 200)}" (environment=${body.environment}, autonomyLevel=${body.autonomyLevel}).`,
    resultStatus: "SUCCESS",
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
  const missions = await listStorefrontMissions(50);
  return NextResponse.json({
    missions: missions.map((m) => ({
      id: m.id,
      goal: m.goal,
      status: m.status,
      environment: m.environment,
      autonomyLevel: m.autonomyLevel,
      totalCostUsd: m.totalCostUsd,
      lastError: m.lastError,
      createdAt: m.createdAt,
      finishedAt: m.finishedAt,
    })),
  });
}
