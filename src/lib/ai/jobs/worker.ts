import type { Job } from "@prisma/client";
import {
  failStep,
  getPriorOutputs,
  heartbeatStep,
  isCancelRequested,
  markJobFailed,
  markJobSucceeded,
  startStepAttempt,
  succeedStep,
} from "@/lib/ai/jobs/store";
import type { JobStepDefinition, VerificationHook } from "@/lib/ai/jobs/types";

/**
 * ONDEAL AI JOB ENGINE — boucle de référence (06/09/2026).
 *
 * `runJobToCompletion` exécute UN job déjà réclamé (voir claimNextQueuedJob,
 * store.ts) du step courant (`job.currentStepIndex`) jusqu'à la fin du plan,
 * ou jusqu'à échec/annulation/timeout. Elle NE décide PAS où elle tourne —
 * c'est le "worker boundary" : cette fonction est appelable aussi bien
 * depuis une route Vercel courte (petits jobs) que depuis un futur worker
 * externe (Trigger.dev ou équivalent — voir l'audit architecture, §12/§29)
 * sans changement. Ce découplage EST la réponse au bottleneck identifié :
 * le code du Job Engine ne sait rien de Vercel, seulement de Postgres.
 *
 * NO BLIND LOOP (règle explicitement demandée, conservée telle quelle) :
 * chaque step a un nombre de tentatives borné, le job entier a une durée
 * murale bornée, et toute sortie de boucle (succès, échec, annulation,
 * timeout) est enregistrée avec sa raison — jamais un arrêt silencieux.
 */

export interface RunJobOptions {
  /** Tentatives max PAR STEP avant d'abandonner le job entier — distinct de Job.maxAttempts (relance globale, décidée par l'appelant, pas ici). */
  maxStepAttempts?: number;
  /** Budget de temps mural pour CET appel de runJobToCompletion — un job plus long doit être repris par un appel suivant (reprise, jamais une boucle sans fin dans un seul process). */
  maxDurationMs?: number;
  verifiers?: VerificationHook[];
}

export type RunJobOutcome =
  | { status: "SUCCEEDED"; result: unknown }
  | { status: "FAILED"; reason: string }
  | { status: "CANCELLED" }
  | { status: "PAUSED_TIMEOUT" }; // pas un échec — le job reste QUEUED/RUNNING en base, un appel suivant reprend à currentStepIndex

export async function runJobToCompletion(job: Job, steps: JobStepDefinition[], opts: RunJobOptions = {}): Promise<RunJobOutcome> {
  const maxStepAttempts = opts.maxStepAttempts ?? 3;
  const maxDurationMs = opts.maxDurationMs ?? 4 * 60 * 1000; // défaut prudent — bien sous les limites Vercel (voir audit, §29)
  const deadline = Date.now() + maxDurationMs;
  const input = job.inputJson ? JSON.parse(job.inputJson) : null;

  let stepIndex = job.currentStepIndex;

  while (stepIndex < steps.length) {
    if (Date.now() > deadline) return { status: "PAUSED_TIMEOUT" };
    if (await isCancelRequested(job.id)) return { status: "CANCELLED" };

    const definition = steps[stepIndex];
    if (!definition) return { status: "FAILED", reason: `Aucun step défini à l'index ${stepIndex}.` };
    const priorOutputs = await getPriorOutputs(job.id, stepIndex);
    const stepInput = stepIndex === 0 ? input : priorOutputs[priorOutputs.length - 1];

    let attemptResult: RunJobOutcome | { ok: true } | null = null;
    for (let attempt = 1; attempt <= maxStepAttempts; attempt++) {
      const stepRow = await startStepAttempt({ jobId: job.id, index: stepIndex, attempt, name: definition.name, input: stepInput });

      try {
        const result = await definition.run({
          jobId: job.id,
          storeId: job.storeId,
          stepIndex,
          attempt,
          priorOutputs,
          input: stepInput,
          cancelRequested: () => isCancelRequested(job.id),
          heartbeat: () => heartbeatStep(stepRow.id),
        });

        if (opts.verifiers) {
          for (const verifier of opts.verifiers) {
            const verdict = await verifier.verify(definition, result);
            if (!verdict.pass) throw new Error(`Vérification "${verifier.name}" échouée : ${verdict.reason ?? "raison non précisée"}.`);
          }
        }

        await succeedStep({
          stepId: stepRow.id,
          jobId: job.id,
          stepIndex,
          output: result.output,
          provider: result.provider,
          model: result.model,
          costUsd: result.costUsd,
          tokensIn: result.tokensIn,
          tokensOut: result.tokensOut,
          artifacts: result.artifacts,
        });
        attemptResult = { ok: true };
        break;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await failStep({ stepId: stepRow.id, error: message });
        if (attempt === maxStepAttempts) {
          await markJobFailed(job.id, `Step "${definition.name}" (index ${stepIndex}) a échoué après ${maxStepAttempts} tentative(s) : ${message}`);
          return { status: "FAILED", reason: message };
        }
        // Retry : nouvelle tentative (attempt+1) au MÊME index — jamais une
        // réécriture de la ligne précédente (voir principe journal d'ajout
        // seul en tête de store.ts).
      }
    }
    if (!attemptResult) return { status: "FAILED", reason: "Boucle de retry terminée sans résultat — état inattendu." };
    stepIndex += 1;
  }

  const finalOutputs = await getPriorOutputs(job.id, stepIndex);
  const result = finalOutputs[finalOutputs.length - 1] ?? null;
  await markJobSucceeded(job.id, result);
  return { status: "SUCCEEDED", result };
}
