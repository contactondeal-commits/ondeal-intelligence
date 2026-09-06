import { NextRequest, NextResponse } from "next/server";
import { CapabilityError, requireCapabilityWithStepUp } from "@/lib/authz/capabilities";
import { OwnerAuthError } from "@/lib/authz/ownerSession";
import { getStorefrontMission } from "@/lib/ai/supervisor/graphStore";
import { dispatchWorkflow, GithubConnectorError } from "@/lib/ai/connectors/github";
import { appendAuditLog } from "@/lib/ai/policy/audit";

/**
 * ONDEAL AI CORE — §33 "durable runner", clôture réelle (06/09/2026).
 *
 * Ferme précisément l'écart documenté depuis la Phase 3 : une mission
 * portant un nœud coder_implementation ne peut pas s'exécuter dans une
 * fonction Vercel (pas de checkout git persistant, pas de Chromium) et
 * devait jusqu'ici être relancée MANUELLEMENT depuis un terminal de
 * développement (scripts/run-ai-lab-mission.ts). Cette route ferme cet
 * écart : un clic Owner ("Lancer via GitHub Actions") déclenche RÉELLEMENT
 * .github/workflows/ai-lab-mission.yml via l'API GitHub (workflow_dispatch),
 * en utilisant le jeton du connecteur GitHub RÉEL (connectors/github.ts) —
 * jamais un jeton de session de développement. Le workflow, dans le runner
 * GitHub Actions, exécute le MÊME scripts/run-ai-lab-mission.ts contre la
 * VRAIE base de production (DATABASE_URL en secret de dépôt) — la mission
 * (StorefrontMission) reste la SEULE source de vérité de son propre état,
 * peu importe où le worker tourne (§21 "MISSION BELONGS TO ONDEAL").
 *
 * Action Owner-gated + step-up : déclencher un run réel coûte de l'argent
 * (minutes GitHub Actions) et peut, selon l'objectif de la mission, modifier
 * du code — jamais ALLOW_AUTO sans re-preuve de possession de la clé.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: missionId } = await params;

  let userId: string;
  try {
    ({ userId } = await requireCapabilityWithStepUp("SYSTEM_CODER"));
  } catch (err) {
    if (err instanceof CapabilityError || err instanceof OwnerAuthError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }

  const mission = await getStorefrontMission(missionId);
  if (!mission) return NextResponse.json({ error: "Mission introuvable." }, { status: 404 });
  if (mission.environment === "PRODUCTION") {
    return NextResponse.json({ error: "Dispatch direct interdit pour une mission environment=PRODUCTION — voir Policy Engine (PRODUCTION_EFFECT ne dépasse jamais REQUIRE_APPROVAL)." }, { status: 403 });
  }

  try {
    await dispatchWorkflow("ai-lab-mission.yml", "master", { missionId });
  } catch (err) {
    const message = err instanceof GithubConnectorError ? err.message : "Échec du déclenchement du workflow.";
    await appendAuditLog({ actorUserId: userId, missionId, action: "mission_dispatch_github_actions", reason: message, resultStatus: "FAILURE" });
    return NextResponse.json({ error: message }, { status: 400 });
  }

  await appendAuditLog({ actorUserId: userId, missionId, action: "mission_dispatch_github_actions", reason: "Workflow ai-lab-mission.yml déclenché réellement via l'API GitHub (workflow_dispatch) — exécution durable hors Vercel.", resultStatus: "SUCCESS" });
  return NextResponse.json({ ok: true, detail: "Workflow GitHub Actions déclenché. Suivez sa progression dans l'onglet Actions du dépôt, ou revenez consulter cette mission — son statut se met à jour dès que le worker écrit en base." });
}
