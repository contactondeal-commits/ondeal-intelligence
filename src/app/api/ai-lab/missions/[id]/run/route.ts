import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { CapabilityError, requireCapability } from "@/lib/authz/capabilities";
import { FailoverProvider } from "@/lib/ai/providers/failover";
import { resolveFailoverCandidates } from "@/lib/ai/models/router";
import { getStorefrontMission, markMissionFailed } from "@/lib/ai/supervisor/graphStore";
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

  // §22-32 "provider continuity" (06/09/2026) : FailoverProvider remplace
  // désormais l'unique `new AnthropicProvider()` — si Anthropic échoue
  // (PROVIDER_DOWN/RATE_LIMIT/...), le candidat suivant (ModelConfig Owner,
  // ou OpenAI par défaut si sa clé est configurée) reprend la MÊME mission,
  // jamais une seconde tentative manuelle. Visible dans GenerateResult
  // .failoverAttempts/.servedBy, jamais un fallback muet.
  const maxWallClockMs = Number(process.env.AI_LAB_MAX_WALL_CLOCK_MS ?? "50000");

  await appendAuditLog({ missionId: id, actorUserId: userId, action: "mission_run_started", reason: `Exécution démarrée par l'Owner (maxWallClockMs=${maxWallClockMs}).`, resultStatus: "SUCCESS" });

  // CORRECTIF DE PRODUCTION (06/09/2026, mission réelle
  // "cmtq415440000l204rqiey6j8") : try/catch de défense en profondeur,
  // REDONDANT AVEC celui déjà ajouté dans runStorefrontMission
  // (graphRunner.ts) — celui-là garantit déjà qu'AUCUNE exception ne
  // s'échappe de l'exécution de la mission elle-même. Celui-ci couvre en
  // plus resolveFailoverCandidates()/new FailoverProvider() (avant même
  // d'entrer dans runStorefrontMission) et les appendAuditLog eux-mêmes —
  // AUCUN chemin, même futur, ne doit pouvoir renvoyer un HTTP 500 brut
  // sans que la mission ne bascule dans un état terminal honnête
  // (FAILED, avec la cause réelle dans lastError) : jamais un statut
  // PLANNING/RUNNING fantôme, quelle que soit l'origine de l'erreur.
  try {
    const candidates = await resolveFailoverCandidates();
    const provider = new FailoverProvider(candidates);

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
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      await markMissionFailed(id, `Erreur fatale non interceptée au niveau de la route d'exécution (avant/hors runStorefrontMission) : ${message}`);
      await appendAuditLog({ missionId: id, actorUserId: userId, action: "mission_run_finished", reason: `Exécution terminée par une exception fatale non interceptée : ${message}`, resultStatus: "FAILURE" });
    } catch (persistErr) {
      console.error(`[ai-lab/missions/run] Échec de la persistance de l'état FAILED pour la mission "${id}" après une erreur fatale :`, persistErr);
    }
    // Réponse JSON propre et honnête (jamais le 500 générique de Next.js) —
    // le Composer peut afficher `outcome.reason` au lieu d'un simple
    // "Erreur HTTP 500" opaque.
    return NextResponse.json({ outcome: { status: "FAILED", missionId: id, reason: message } }, { status: 500 });
  }
}
