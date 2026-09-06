import { prisma } from "@/lib/db";
import type { JobArtifactKind } from "@/lib/ai/jobs/types";

/**
 * ONDEAL AI CORE — PHASE 3 : couche DB des missions Coder Agent (06/09/2026).
 *
 * Réutilisation DÉLIBÉRÉE et LITTÉRALE de la mécanique src/lib/ai/jobs/
 * store.ts (§5 de la commande : "réutilise-les") : journal d'ajout seul
 * pour CoderMissionStep (un retry crée une NOUVELLE ligne, jamais une
 * réécriture), currentStepIndex comme SEULE source de reprise, avancé
 * atomiquement avec le succès du step, dans la même transaction. Seule
 * différence structurelle avec jobs/store.ts : aucune notion de storeId —
 * une mission n'est jamais scopée à une boutique (voir schema.prisma).
 */

const STALE_HEARTBEAT_MS = 10 * 60 * 1000; // même valeur que jobs/store.ts (STALE_HEARTBEAT_MS)

export async function createMission(params: { goal: string; createdByUserId: string; maxAttempts?: number }) {
  return prisma.coderMission.create({
    data: {
      goal: params.goal,
      createdByUserId: params.createdByUserId,
      maxAttempts: params.maxAttempts ?? 3,
    },
  });
}

export async function getMission(missionId: string) {
  return prisma.coderMission.findUnique({
    where: { id: missionId },
    include: { steps: { orderBy: [{ index: "asc" }, { attempt: "asc" }] } },
  });
}

export async function listMissions(take = 20) {
  return prisma.coderMission.findMany({ orderBy: { createdAt: "desc" }, take });
}

/** Réclame une mission QUEUED pour exécution — même verrou FOR UPDATE SKIP LOCKED que claimNextQueuedJob (jobs/store.ts), adapté à une seule mission ciblée par id (déclenchement explicite, jamais un polling autonome — §15 : autonomie complète MAIS toujours déclenchée par une mission explicitement créée). */
export async function claimMissionById(missionId: string) {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "coder_missions"
      WHERE "id" = ${missionId} AND "status" IN ('QUEUED', 'WAITING_RETRY')
      FOR UPDATE SKIP LOCKED
    `;
    const claimed = rows[0];
    if (!claimed) return null;
    return tx.coderMission.update({ where: { id: claimed.id }, data: { status: "RUNNING", startedAt: new Date() } });
  });
}

export async function startStepAttempt(params: { missionId: string; index: number; attempt: number; name: string; input: unknown }) {
  return prisma.coderMissionStep.create({
    data: {
      missionId: params.missionId,
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
  await prisma.coderMissionStep.update({ where: { id: stepId }, data: { heartbeatAt: new Date() } });
}

export async function succeedStep(params: {
  stepId: string;
  missionId: string;
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
    await tx.coderMissionStep.update({
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
      await tx.coderMissionArtifact.createMany({
        data: params.artifacts.map((a) => ({
          missionId: params.missionId,
          stepId: params.stepId,
          kind: a.kind,
          storageRef: a.storageRef,
          metaJson: a.meta ? JSON.stringify(a.meta) : null,
        })),
      });
    }
    await tx.coderMission.updateMany({
      where: { id: params.missionId, currentStepIndex: params.stepIndex },
      data: { currentStepIndex: params.stepIndex + 1, updatedAt: new Date() },
    });
  });
}

export async function failStep(params: { stepId: string; error: string }) {
  await prisma.coderMissionStep.update({
    where: { id: params.stepId },
    data: { status: "FAILED", finishedAt: new Date(), errorJson: JSON.stringify({ error: params.error }) },
  });
}

export async function getPriorOutputs(missionId: string, currentStepIndex: number): Promise<unknown[]> {
  if (currentStepIndex <= 0) return [];
  const steps = await prisma.coderMissionStep.findMany({
    where: { missionId, status: "SUCCEEDED", index: { lt: currentStepIndex } },
    orderBy: [{ index: "asc" }, { attempt: "desc" }],
  });
  const byIndex = new Map<number, unknown>();
  for (const s of steps) {
    if (!byIndex.has(s.index)) byIndex.set(s.index, s.outputJson ? JSON.parse(s.outputJson) : null);
  }
  return [...byIndex.entries()].sort(([a], [b]) => a - b).map(([, output]) => output);
}

export async function markMissionSucceeded(missionId: string, result: unknown) {
  await prisma.coderMission.update({
    where: { id: missionId },
    data: { status: "SUCCEEDED", resultJson: JSON.stringify(result), finishedAt: new Date() },
  });
}

export async function markMissionFailed(missionId: string, lastError: string) {
  await prisma.coderMission.update({
    where: { id: missionId },
    data: { status: "FAILED", lastError, finishedAt: new Date() },
  });
}

export async function isCancelRequested(missionId: string): Promise<boolean> {
  const mission = await prisma.coderMission.findUnique({ where: { id: missionId }, select: { cancelRequested: true } });
  return mission?.cancelRequested ?? false;
}

export async function requestMissionCancellation(missionId: string, requestedByUserId: string): Promise<boolean> {
  // requestedByUserId n'est pas encore utilisé dans WHERE (pas de scoping par utilisateur créateur ici —
  // le gate d'autorisation réel est requireCapability("SYSTEM_CODER") en amont, côté route ; paramètre
  // conservé pour un futur audit fin, jamais silencieusement ignoré côté signature).
  const result = await prisma.coderMission.updateMany({ where: { id: missionId }, data: { cancelRequested: true } });
  void requestedByUserId;
  return result.count > 0;
}

export function stepHeartbeatStale(step: { status: string; heartbeatAt: Date | null; startedAt: Date | null }): boolean {
  if (step.status !== "RUNNING") return false;
  const reference = step.heartbeatAt ?? step.startedAt;
  if (!reference) return true;
  return Date.now() - reference.getTime() > STALE_HEARTBEAT_MS;
}
