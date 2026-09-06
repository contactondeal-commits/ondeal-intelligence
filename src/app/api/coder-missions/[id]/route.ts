import { NextRequest, NextResponse } from "next/server";
import { CapabilityError, requireCapability } from "@/lib/authz/capabilities";
import { getMission } from "@/lib/ai/coder/missionStore";

/**
 * ONDEAL AI CORE — PHASE 3 (06/09/2026). CONTROL PLANE, SYSTEM_CODER
 * uniquement — voir src/app/api/coder-missions/route.ts pour le contexte
 * complet. Lecture seule : détail d'une mission + ses steps (journal
 * d'ajout seul, voir schema.prisma).
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await requireCapability("SYSTEM_CODER");
  } catch (err) {
    if (err instanceof CapabilityError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }

  const mission = await getMission(id);
  if (!mission) return NextResponse.json({ error: "Mission introuvable." }, { status: 404 });

  return NextResponse.json({
    mission: {
      id: mission.id,
      goal: mission.goal,
      status: mission.status,
      currentStepIndex: mission.currentStepIndex,
      lastError: mission.lastError,
      resultJson: mission.resultJson ? JSON.parse(mission.resultJson) : null,
      createdAt: mission.createdAt,
      finishedAt: mission.finishedAt,
      steps: mission.steps.map((s) => ({
        index: s.index,
        attempt: s.attempt,
        name: s.name,
        status: s.status,
        provider: s.provider,
        model: s.model,
        costUsd: s.costUsd,
        startedAt: s.startedAt,
        finishedAt: s.finishedAt,
        errorJson: s.errorJson ? JSON.parse(s.errorJson) : null,
      })),
    },
  });
}
