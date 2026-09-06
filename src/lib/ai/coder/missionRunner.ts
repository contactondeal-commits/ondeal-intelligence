import type { CoderMission } from "@prisma/client";
import {
  failStep,
  getPriorOutputs,
  heartbeatStep,
  isCancelRequested,
  markMissionFailed,
  markMissionSucceeded,
  startStepAttempt,
  succeedStep,
} from "@/lib/ai/coder/missionStore";
import type { MissionStepDefinition } from "@/lib/ai/coder/types";

/**
 * ONDEAL AI CORE — PHASE 3 : boucle de mission (06/09/2026).
 *
 * Structurellement IDENTIQUE à src/lib/ai/jobs/worker.ts::runJobToCompletion
 * (§5 : réutilisation explicite du Job Engine) : NO BLIND LOOP (tentatives
 * bornées par step, durée murale bornée pour CET appel, toute sortie de
 * boucle enregistrée avec sa raison), reprise via currentStepIndex, retry
 * par nouvelle ligne jamais une réécriture. Seule différence : opère sur
 * CoderMission/CoderMissionStep (missionStore.ts), jamais sur Job/JobStep
 * — une mission Coder Agent n'est jamais scopée par storeId.
 *
 * Cette fonction ne décide PAS où elle tourne — comme runJobToCompletion,
 * c'est le worker boundary : elle est appelable depuis ce sandbox de
 * développement (preuve du vertical slice), un futur runner GitHub Actions,
 * ou tout process Node avec un accès filesystem + réseau (voir le rapport
 * de session, "DEV PROOF vs PRODUCT RUNTIME" — jamais depuis une fonction
 * serverless Vercel, qui n'a ni checkout git persistant ni navigateur).
 */

export interface RunMissionOptions {
  maxStepAttempts?: number;
  maxDurationMs?: number;
}

export type RunMissionOutcome =
  | { status: "SUCCEEDED"; result: unknown }
  | { status: "FAILED"; reason: string }
  | { status: "CANCELLED" }
  | { status: "PAUSED_TIMEOUT" };

export async function runMissionToCompletion(
  mission: CoderMission,
  steps: MissionStepDefinition[],
  opts: RunMissionOptions = {},
): Promise<RunMissionOutcome> {
  const maxStepAttempts = opts.maxStepAttempts ?? 3;
  const maxDurationMs = opts.maxDurationMs ?? 10 * 60 * 1000; // une mission Coder Agent (typecheck+lint+test+build+browser) est plus longue qu'un step de Job Engine classique — budget prudent mais généreux
  const deadline = Date.now() + maxDurationMs;

  let stepIndex = mission.currentStepIndex;

  while (stepIndex < steps.length) {
    if (Date.now() > deadline) return { status: "PAUSED_TIMEOUT" };
    if (await isCancelRequested(mission.id)) return { status: "CANCELLED" };

    const definition = steps[stepIndex];
    if (!definition) return { status: "FAILED", reason: `Aucun step défini à l'index ${stepIndex}.` };
    const priorOutputs = await getPriorOutputs(mission.id, stepIndex);
    const stepInput = stepIndex === 0 ? { goal: mission.goal } : priorOutputs[priorOutputs.length - 1];

    let succeeded = false;
    for (let attempt = 1; attempt <= maxStepAttempts; attempt++) {
      const stepRow = await startStepAttempt({ missionId: mission.id, index: stepIndex, attempt, name: definition.name, input: stepInput });

      try {
        const result = await definition.run({
          missionId: mission.id,
          stepIndex,
          attempt,
          priorOutputs,
          input: stepInput,
          cancelRequested: () => isCancelRequested(mission.id),
          heartbeat: () => heartbeatStep(stepRow.id),
        });

        await succeedStep({
          stepId: stepRow.id,
          missionId: mission.id,
          stepIndex,
          output: result.output,
          provider: result.provider,
          model: result.model,
          costUsd: result.costUsd,
          tokensIn: result.tokensIn,
          tokensOut: result.tokensOut,
          artifacts: result.artifacts,
        });
        succeeded = true;
        break;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await failStep({ stepId: stepRow.id, error: message });
        if (attempt === maxStepAttempts) {
          await markMissionFailed(mission.id, `Step "${definition.name}" (index ${stepIndex}) a échoué après ${maxStepAttempts} tentative(s) : ${message}`);
          return { status: "FAILED", reason: message };
        }
      }
    }
    if (!succeeded) return { status: "FAILED", reason: "Boucle de retry terminée sans résultat — état inattendu." };
    stepIndex += 1;
  }

  const finalOutputs = await getPriorOutputs(mission.id, stepIndex);
  const result = finalOutputs[finalOutputs.length - 1] ?? null;
  await markMissionSucceeded(mission.id, result);
  return { status: "SUCCEEDED", result };
}
