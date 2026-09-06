import { prisma } from "@/lib/db";
import { AnthropicProvider } from "@/lib/ai/providers/anthropic";
import { estimateCostUsd } from "@/lib/ai/models/cost";
import { GROUNDING_TASKS, GROUNDING_TASK_SET, type ModelEvalTask } from "@/lib/ai/models/tasks";
import type { ModelProvider } from "@/lib/ai/providers/provider";

/**
 * ONDEAL AI CORE — PHASE 2 : EvaluationRunner réel (06/09/2026).
 *
 * Fait RÉELLEMENT tourner chaque modèle candidat contre le MÊME jeu de
 * tâches fixe (voir tasks.ts), avec le VRAI provider (aucun mock, aucun
 * texte simulé — "no partial theater", §82 de la commande). Persiste
 * CHAQUE résultat individuel (une ligne ModelEvalResult par tâche × modèle),
 * jamais seulement une moyenne — le futur Router (router.ts) a besoin du
 * détail pour agréger correctement, et un humain doit pouvoir auditer
 * chaque décision pass/fail individuellement (EVIDENCE, comme Phase 1).
 *
 * Les deux seuls modèles réellement provisionnés en production aujourd'hui
 * (voir src/lib/ai/providers/anthropic.ts, ANTHROPIC_CAPABILITIES) — aucun
 * nouveau provider/credential nécessaire pour que "au moins deux
 * configurations" (§61) soit réellement vrai.
 */
export const DEFAULT_EVAL_MODELS = ["claude-haiku-4-5-20251001", "claude-fable-5-1"] as const;

const TEXT_SAMPLE_MAX_CHARS = 300;

export interface ModelEvalResultRow {
  provider: string;
  model: string;
  taskName: string;
  passed: boolean;
  reason: string | null;
  latencyMs: number;
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: number | null;
  textSample: string | null;
}

export interface ModelEvalSummary {
  runId: string;
  taskSetName: string;
  results: ModelEvalResultRow[];
}

async function evaluateOneTask(
  provider: ModelProvider,
  model: string,
  task: ModelEvalTask,
): Promise<ModelEvalResultRow> {
  const startedAt = Date.now();
  try {
    const generated = await provider.generate({
      model,
      system: task.system,
      userMessage: task.userMessage,
      maxTokens: task.maxTokens,
    });
    const latencyMs = Date.now() - startedAt;
    const verdict = task.verify(generated.text);
    const costUsd = estimateCostUsd(provider, model, generated.tokensIn, generated.tokensOut);
    return {
      provider: provider.name,
      model,
      taskName: task.name,
      passed: verdict.pass,
      reason: verdict.reason ?? null,
      latencyMs,
      tokensIn: generated.tokensIn,
      tokensOut: generated.tokensOut,
      costUsd,
      textSample: generated.text.slice(0, TEXT_SAMPLE_MAX_CHARS),
    };
  } catch (err) {
    // Un échec d'appel réseau/API est un FAIL réel pour ce modèle sur cette
    // tâche — jamais une ligne omise (ça fausserait le taux de réussite du
    // Router à la hausse) ni un succès inventé.
    const latencyMs = Date.now() - startedAt;
    const message = err instanceof Error ? err.message : String(err);
    return {
      provider: provider.name,
      model,
      taskName: task.name,
      passed: false,
      reason: `Erreur d'appel modèle : ${message}`,
      latencyMs,
      tokensIn: null,
      tokensOut: null,
      costUsd: null,
      textSample: null,
    };
  }
}

/**
 * Lance un run réel : chaque modèle de `models` contre chaque tâche de
 * `tasks`, séquentiellement (pas de parallélisme agressif — coût-aware,
 * §57 : ne jamais dépenser plus que nécessaire pour un gain démontrable).
 * Persiste un ModelEvalRun + une ligne ModelEvalResult par (modèle, tâche).
 */
export async function runModelEvaluation(opts: {
  models?: readonly string[];
  tasks?: readonly ModelEvalTask[];
  provider?: ModelProvider;
} = {}): Promise<ModelEvalSummary> {
  const models = opts.models ?? DEFAULT_EVAL_MODELS;
  const tasks = opts.tasks ?? GROUNDING_TASKS;
  const provider = opts.provider ?? new AnthropicProvider();

  const run = await prisma.modelEvalRun.create({ data: { taskSetName: GROUNDING_TASK_SET } });

  const rows: ModelEvalResultRow[] = [];
  for (const model of models) {
    for (const task of tasks) {
      const row = await evaluateOneTask(provider, model, task);
      rows.push(row);
      await prisma.modelEvalResult.create({
        data: {
          runId: run.id,
          provider: row.provider,
          model: row.model,
          taskName: row.taskName,
          passed: row.passed,
          reason: row.reason,
          latencyMs: row.latencyMs,
          tokensIn: row.tokensIn,
          tokensOut: row.tokensOut,
          costUsd: row.costUsd,
          textSample: row.textSample,
        },
      });
    }
  }

  return { runId: run.id, taskSetName: run.taskSetName, results: rows };
}
