import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { JobArtifactKind } from "@/lib/ai/jobs/types";

/**
 * ONDEAL AI JOB ENGINE — couche DB (06/09/2026).
 *
 * Principe central, répété ici parce qu'il gouverne toute cette fondation :
 * JobStep est un journal D'AJOUT SEUL. Une tentative échouée n'est jamais
 * réécrite ni supprimée — une nouvelle tentative (attempt+1) crée une
 * NOUVELLE ligne au même `index`. Conséquence directe : reprise, retry et
 * audit sont la MÊME donnée (l'historique complet des tentatives), jamais
 * trois mécanismes séparés à maintenir en cohérence.
 *
 * `Job.currentStepIndex` est la SEULE source de vérité pour "où reprendre"
 * — jamais un recalcul déduit des lignes JobStep à la volée. Elle n'avance
 * que dans `succeedStep()`, atomiquement avec l'écriture du succès du step,
 * dans la même transaction.
 */

const STALE_HEARTBEAT_MS = 10 * 60 * 1000; // 10 min sans heartbeat = step abandonné (même principe que RUNNING_GUARD_MS, cron/sync/route.ts)

export async function createJob(params: {
  storeId: string;
  type: string;
  input: unknown;
  createdByUserId?: string | null;
  maxAttempts?: number;
}) {
  return prisma.job.create({
    data: {
      storeId: params.storeId,
      type: params.type,
      inputJson: JSON.stringify(params.input),
      createdByUserId: params.createdByUserId ?? null,
      maxAttempts: params.maxAttempts ?? 3,
    },
  });
}

/**
 * Réclame le prochain job éligible (QUEUED, ou WAITING_RETRY dont le
 * dernier step a un heartbeat périmé) via FOR UPDATE SKIP LOCKED — plusieurs
 * workers concurrents ne se marchent jamais dessus, sans file d'attente
 * dédiée (voir l'audit : "Postgres comme file d'attente" est un choix
 * délibéré à cette échelle, pas une impasse — Prisma ne wrappe pas SKIP
 * LOCKED nativement, d'où le SQL brut, dans le même style que
 * src/lib/pricing/query.ts).
 */
export async function claimNextQueuedJob() {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`
        SELECT "id" FROM "jobs"
        WHERE "status" = 'QUEUED'
        ORDER BY "createdAt" ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `,
    );
    const claimed = rows[0];
    if (!claimed) return null;
    return tx.job.update({
      where: { id: claimed.id },
      data: { status: "RUNNING", startedAt: new Date() },
    });
  });
}

export function stepHeartbeatStale(step: { status: string; heartbeatAt: Date | null; startedAt: Date | null }): boolean {
  if (step.status !== "RUNNING") return false;
  const reference = step.heartbeatAt ?? step.startedAt;
  if (!reference) return true;
  return Date.now() - reference.getTime() > STALE_HEARTBEAT_MS;
}

export async function startStepAttempt(params: { jobId: string; index: number; attempt: number; name: string; input: unknown }) {
  return prisma.jobStep.create({
    data: {
      jobId: params.jobId,
      index: params.index,
      attempt: params.attempt,
      name: params.name,
      status: "RUNNING",
      inputJson: JSON.stringify(params.input),
      startedAt: new Date(),
      heartbeatAt: new Date(),
    },
  });
}

export async function heartbeatStep(stepId: string) {
  await prisma.jobStep.update({ where: { id: stepId }, data: { heartbeatAt: new Date() } });
}

/**
 * Marque le step réussi ET avance Job.currentStepIndex dans la MÊME
 * transaction — jamais l'un sans l'autre, pour que la reprise ne saute
 * jamais un step ni ne le rejoue à tort après un crash entre les deux
 * écritures.
 */
export async function succeedStep(params: {
  stepId: string;
  jobId: string;
  stepIndex: number;
  output: unknown;
  provider?: string;
  model?: string;
  costUsd?: number;
  tokensIn?: number;
  tokensOut?: number;
  artifacts?: Array<{ kind: JobArtifactKind; storageRef: string; meta?: Record<string, unknown> }>;
}) {
  await prisma.$transaction(async (tx) => {
    await tx.jobStep.update({
      where: { id: params.stepId },
      data: {
        status: "SUCCEEDED",
        outputJson: JSON.stringify(params.output),
        finishedAt: new Date(),
        provider: params.provider ?? null,
        model: params.model ?? null,
        costUsd: params.costUsd ?? null,
        tokensIn: params.tokensIn ?? null,
        tokensOut: params.tokensOut ?? null,
      },
    });
    if (params.artifacts && params.artifacts.length > 0) {
      await tx.jobArtifact.createMany({
        data: params.artifacts.map((a) => ({
          jobId: params.jobId,
          stepId: params.stepId,
          kind: a.kind,
          storageRef: a.storageRef,
          metaJson: a.meta ? JSON.stringify(a.meta) : null,
        })),
      });
    }
    // Garde anti-course : n'avance que si currentStepIndex est encore celui
    // attendu — un double traitement concurrent du même step (ne devrait
    // jamais arriver avec claimNextQueuedJob, mais defense-in-depth) ne fait
    // jamais avancer l'index deux fois.
    await tx.job.updateMany({
      where: { id: params.jobId, currentStepIndex: params.stepIndex },
      data: { currentStepIndex: params.stepIndex + 1, updatedAt: new Date() },
    });
  });
}

export async function failStep(params: { stepId: string; error: string }) {
  await prisma.jobStep.update({
    where: { id: params.stepId },
    data: { status: "FAILED", finishedAt: new Date(), errorJson: JSON.stringify({ error: params.error }) },
  });
}

/** Sorties, dans l'ordre, de tous les steps déjà réussis (index < currentStepIndex) — jamais les tentatives échouées. */
export async function getPriorOutputs(jobId: string, currentStepIndex: number): Promise<unknown[]> {
  if (currentStepIndex <= 0) return [];
  const steps = await prisma.jobStep.findMany({
    where: { jobId, status: "SUCCEEDED", index: { lt: currentStepIndex } },
    orderBy: [{ index: "asc" }, { attempt: "desc" }],
  });
  // Un seul SUCCEEDED par index par construction (succeedStep n'avance
  // l'index qu'une fois) — dédoublonnage défensif si jamais ce n'était pas
  // le cas, en gardant la tentative la plus récente par index.
  const byIndex = new Map<number, unknown>();
  for (const s of steps) {
    if (!byIndex.has(s.index)) byIndex.set(s.index, s.outputJson ? JSON.parse(s.outputJson) : null);
  }
  return [...byIndex.entries()].sort(([a], [b]) => a - b).map(([, output]) => output);
}

export async function markJobSucceeded(jobId: string, result: unknown) {
  await prisma.job.update({
    where: { id: jobId },
    data: { status: "SUCCEEDED", resultJson: JSON.stringify(result), finishedAt: new Date() },
  });
}

export async function markJobFailed(jobId: string, lastError: string) {
  await prisma.job.update({
    where: { id: jobId },
    data: { status: "FAILED", lastError, finishedAt: new Date() },
  });
}

export async function markJobWaitingRetry(jobId: string, lastError: string) {
  await prisma.job.update({
    where: { id: jobId },
    data: { status: "WAITING_RETRY", lastError, attempt: { increment: 1 } },
  });
}

export async function requeueJobForRetry(jobId: string) {
  await prisma.job.update({ where: { id: jobId }, data: { status: "QUEUED" } });
}

/** Scopée par storeId — appelée depuis une route API (tenant isolation, jamais un accès direct par id seul côté utilisateur). */
export async function requestCancellation(jobId: string, storeId: string) {
  const result = await prisma.job.updateMany({
    where: { id: jobId, storeId },
    data: { cancelRequested: true },
  });
  return result.count > 0;
}

export async function getJobForStore(jobId: string, storeId: string) {
  return prisma.job.findFirst({
    where: { id: jobId, storeId },
    include: { steps: { orderBy: [{ index: "asc" }, { attempt: "asc" }] } },
  });
}

export async function isCancelRequested(jobId: string): Promise<boolean> {
  const job = await prisma.job.findUnique({ where: { id: jobId }, select: { cancelRequested: true } });
  return job?.cancelRequested ?? false;
}

/**
 * Réclame UN job précis par id (contrairement à claimNextQueuedJob, qui
 * pioche dans la file globale) — pour l'exécution à la demande via
 * POST /api/jobs/[id]/run (06/09/2026, PHASE 1 vertical slice). Garde
 * NO DUPLICATE CLAIM : `updateMany` scopé par id + storeId + statut éligible
 * est une opération atomique côté Postgres pour une même ligne (le verrou de
 * ligne pris par l'UPDATE garantit qu'un second appel concurrent, quel qu'il
 * soit, voit le statut déjà changé et obtient count === 0) — pas besoin de
 * FOR UPDATE SKIP LOCKED ici, qui répond à un problème différent (choisir UNE
 * ligne parmi plusieurs candidates, voir claimNextQueuedJob).
 */
export async function claimJobById(jobId: string, storeId: string) {
  const result = await prisma.job.updateMany({
    where: { id: jobId, storeId, status: { in: ["QUEUED", "WAITING_RETRY"] } },
    data: { status: "RUNNING", startedAt: new Date() },
  });
  if (result.count === 0) return null;
  return prisma.job.findFirst({ where: { id: jobId, storeId } });
}
