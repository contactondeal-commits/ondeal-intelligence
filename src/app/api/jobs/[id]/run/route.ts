import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, WRITE_ROLES, requireRole, requireStoreAccess } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { claimJobById, getJobForStore } from "@/lib/ai/jobs/store";
import { getJobPlan } from "@/lib/ai/jobs/registry";
import { runJobToCompletion } from "@/lib/ai/jobs/worker";

// ONDEAL AI JOB ENGINE — PHASE 1 vertical slice réel (06/09/2026).
//
// C'est le "REAL WORKER" à la demande : contrairement à POST /api/jobs (qui
// ne fait QUE créer la ligne QUEUED), cette route exécute réellement le job
// jusqu'à SUCCEEDED / FAILED / CANCELLED / PAUSED_TIMEOUT, dans le process
// de la requête (bornée par RunJobOptions.maxDurationMs, largement sous les
// limites Vercel — voir worker.ts). Volontairement PAS de cron ni de
// Trigger.dev : ce sont des dépendances externes payantes hors scope de ce
// chantier (voir stop condition #3, mandat d'exécution) ; cette route reste
// un déclenchement explicite et authentifié, jamais autonome.
//
// Aucune mutation Shopify n'est possible depuis ce chantier : le seul type
// de job réellement exécutable aujourd'hui (voir registry.ts) est
// "analyze_margin_risk", strictement READ-ONLY.
const bodySchema = z.object({ storeId: z.string().min(1).max(64) }).strict();

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: jobId } = await params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Paramètres invalides." }, { status: 400 });
  const { storeId } = parsed.data;

  let userId: string;
  try {
    const access = await requireStoreAccess(storeId);
    userId = access.userId;
    requireRole(access.role, WRITE_ROLES);
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }

  const existing = await getJobForStore(jobId, storeId);
  if (!existing) return NextResponse.json({ error: "Job introuvable pour cette boutique." }, { status: 404 });

  const plan = getJobPlan(existing.type);
  if (!plan) {
    return NextResponse.json(
      { error: `Aucun plan d'exécution réel pour le type de job "${existing.type}".` },
      { status: 400 },
    );
  }

  const claimed = await claimJobById(jobId, storeId);
  if (!claimed) {
    return NextResponse.json(
      { error: "Job non éligible à l'exécution (déjà en cours, déjà terminé, ou introuvable)." },
      { status: 409 },
    );
  }

  await logAudit({
    storeId,
    userId,
    actorType: "user",
    event: "job.run_started",
    message: `Exécution démarrée pour le job ${jobId} (${existing.type}).`,
    meta: { jobId, type: existing.type },
  });

  const outcome = await runJobToCompletion(claimed, plan.steps);

  await logAudit({
    storeId,
    userId,
    actorType: "user",
    event: "job.run_finished",
    message: `Exécution terminée pour le job ${jobId} : ${outcome.status}.`,
    meta: { jobId, type: existing.type, status: outcome.status },
  });

  const refreshed = await getJobForStore(jobId, storeId);
  return NextResponse.json({
    outcome,
    job: refreshed
      ? {
          id: refreshed.id,
          status: refreshed.status,
          currentStepIndex: refreshed.currentStepIndex,
          lastError: refreshed.lastError,
          result: refreshed.resultJson ? JSON.parse(refreshed.resultJson) : null,
        }
      : null,
  });
}
