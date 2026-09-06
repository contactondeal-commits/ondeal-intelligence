import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { CapabilityError, requireCapability } from "@/lib/authz/capabilities";
import { AnthropicProvider } from "@/lib/ai/providers/anthropic";
import { getStorefrontMission } from "@/lib/ai/supervisor/graphStore";
import { runStorefrontMission } from "@/lib/ai/supervisor/graphRunner";
import { appendAuditLog } from "@/lib/ai/policy/audit";

/**
 * ONDEAL AI CORE — PHASE 5 : exécution d'une mission AI Lab (06/09/2026).
 *
 * FRONTIÈRE HONNÊTE (héritée de Phase 3/4, jamais contournée ici) : cette
 * route exécute RÉELLEMENT `runStorefrontMission`, dans le process de la
 * requête, bornée par `maxWallClockMs` (bien sous les limites Vercel).
 *
 *   - Une mission dont le plan ne comporte QUE des rôles de cognition pure
 *     (analystes, "researcher", "data_analyst", "synthesis", "independent_judge"
 *     sans "coder_implementation") s'exécute intégralement dans CETTE route,
 *     en production Vercel comme en dev — même mécanisme que
 *     src/lib/intelligence/assistant.ts (appels Anthropic déjà en
 *     production).
 *   - Une mission dont le plan comporte "coder_implementation" échouera
 *     RÉELLEMENT sur Vercel à ce node précis (pas de checkout git
 *     persistant, pas de Chromium bundlable) — le node se termine FAILED
 *     avec l'erreur réelle, jamais un succès fabriqué. Pour ce cas, utiliser
 *     `tsx scripts/run-ai-lab-mission.ts` (ce dev sandbox) ou le workflow
 *     GitHub Actions (.github/workflows/coder-mission.yml, même limitation
 *     documentée que Phase 3/4 : conçu, pas encore auto-déclenché).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let userId: string;
  try {
    ({ userId } = await requireCapability("SYSTEM_CODER"));
  } catch (err) {
    if (err instanceof CapabilityError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }

  const mission = await getStorefrontMission(id);
  if (!mission) return NextResponse.json({ error: "Mission introuvable." }, { status: 404 });
  if (["SUCCEEDED", "FAILED", "CANCELLED"].includes(mission.status)) {
    return NextResponse.json({ error: `Mission déjà dans un état terminal (${mission.status}) — non ré-exécutable (créer une nouvelle mission).` }, { status: 409 });
  }

  const provider = new AnthropicProvider();
  const maxWallClockMs = Number(process.env.AI_LAB_MAX_WALL_CLOCK_MS ?? "50000");

  await appendAuditLog({ missionId: id, actorUserId: userId, action: "mission_run_started", reason: `Exécution démarrée par l'Owner (maxWallClockMs=${maxWallClockMs}).`, resultStatus: "SUCCESS" });

  const outcome = await runStorefrontMission(id, {
    provider,
    sourceRepoRoot: process.env.AI_LAB_SOURCE_REPO_ROOT ?? path.resolve(process.cwd()),
    createdByUserId: userId,
    coderSecurity: { allowedPathPrefixes: ["src/app", "src/components"], maxCostUsd: 2, maxFixIterations: 2, operationTimeoutMs: 120_000 },
    coderPreviewPort: Number(process.env.AI_LAB_PREVIEW_PORT ?? "4600"),
    hardBudgetUsd: mission.hardBudgetUsd ?? undefined,
    maxWallClockMs,
  });

  await appendAuditLog({ missionId: id, actorUserId: userId, action: "mission_run_finished", reason: `Exécution terminée : ${outcome.status}.`, resultStatus: outcome.status === "SUCCEEDED" ? "SUCCESS" : outcome.status === "FAILED" ? "FAILURE" : "SUCCESS" });

  return NextResponse.json({ outcome });
}
