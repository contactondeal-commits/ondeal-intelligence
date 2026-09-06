/**
 * ONDEAL AI JOB ENGINE — types partagés (06/09/2026).
 * Miroir TypeScript des enums Prisma (Job/JobStep/JobArtifact — voir
 * schema.prisma) plus les formes utilisées par le worker et les futurs
 * appelants. Le type de job (`Job.type`) reste une STRING libre, jamais un
 * enum Prisma — un nouveau type de tâche (ex. futur générateur de boutique)
 * ne doit jamais nécessiter de migration de schéma.
 */

export type JobStatus = "QUEUED" | "PLANNING" | "RUNNING" | "WAITING_RETRY" | "PAUSED" | "SUCCEEDED" | "FAILED" | "CANCELLED";
export type JobStepStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "SKIPPED";
export type JobArtifactKind = "SCREENSHOT" | "FILE" | "DIFF" | "LOG" | "OTHER";

/** États terminaux — un job dans un de ces états n'est plus jamais repris par le worker. */
export const TERMINAL_JOB_STATUSES: ReadonlySet<JobStatus> = new Set(["SUCCEEDED", "FAILED", "CANCELLED"]);

/**
 * Un step est une fonction pure du point de vue du plan : reçoit l'input du
 * job + les sorties des steps précédents, produit une sortie + des
 * artefacts optionnels. Le CONTENU réel d'un step (appel modèle, outil,
 * navigateur…) est délibérément hors du scope de cette fondation — ce
 * contrat n'implémente aucun step concret, seulement la mécanique
 * d'exécution/reprise/retry qui les entourera.
 */
export interface JobStepContext {
  jobId: string;
  storeId: string;
  stepIndex: number;
  attempt: number;
  /** Sorties de TOUS les steps précédemment réussis, dans l'ordre — jamais les tentatives échouées. */
  priorOutputs: unknown[];
  input: unknown;
  /** Signal d'annulation coopérative — un step long DOIT le vérifier périodiquement et s'arrêter proprement si true. */
  cancelRequested(): Promise<boolean>;
  /** Rafraîchit JobStep.heartbeatAt — à appeler pendant un step long pour ne pas être considéré abandonné (voir RUNNING_GUARD_MS, cron/sync/route.ts). */
  heartbeat(): Promise<void>;
}

export interface JobStepResult {
  output: unknown;
  artifacts?: Array<{ kind: JobArtifactKind; storageRef: string; meta?: Record<string, unknown> }>;
  provider?: string;
  model?: string;
  costUsd?: number;
  tokensIn?: number;
  tokensOut?: number;
}

export interface JobStepDefinition {
  name: string;
  run(ctx: JobStepContext): Promise<JobStepResult>;
}

/**
 * Vérification hooks (§9 de la commande) — contrat, aucune implémentation
 * concrète dans cette fondation. Un vérificateur juge la sortie MÉCANIQUE
 * d'un step (ça compile, le format est correct) — jamais la qualité
 * subjective (ça, c'est le futur Critic/Judge, hors fondation).
 */
export interface VerificationHook {
  name: string;
  verify(step: JobStepDefinition, result: JobStepResult): Promise<{ pass: boolean; reason?: string }>;
}

/**
 * Evaluation hooks (§10) — même logique que VerificationHook mais au niveau
 * du JOB entier, une fois terminé, pour alimenter le futur ONDEAL GAUNTLET
 * (voir src/lib/ai/gauntlet/). Aucune implémentation ici — seulement le
 * format que le Gauntlet consommera plus tard.
 */
export interface EvaluationHook {
  name: string;
  evaluate(job: { type: string; input: unknown; result: unknown }): Promise<{ score: number; passed: boolean; notes?: string }>;
}
