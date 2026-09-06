/**
 * ONDEAL AI CORE — PHASE 3 : SYSTEM CODER, types partagés (06/09/2026).
 *
 * Miroir du contrat Job Engine (src/lib/ai/jobs/types.ts) mais pour une
 * MISSION Coder Agent — pas de storeId (voir schema.prisma, section PHASE
 * 3). Un step de mission est, comme un JobStep, une fonction du contexte +
 * des sorties précédentes vers un résultat + artefacts optionnels — la
 * mécanique d'exécution/reprise/retry est réutilisée telle quelle
 * (missionRunner.ts est structurellement identique à jobs/worker.ts).
 *
 * Pas de `workspaceRoot` dans le contexte : le workspace est créé par le
 * PREMIER step ("inspect", voir steps.ts) et propagé via sa sortie
 * (`priorOutputs`), exactement comme n'importe quelle autre donnée
 * inter-step — jamais un canal parallèle implicite que le runner devrait
 * connaître.
 */

import type { JobArtifactKind } from "@/lib/ai/jobs/types";

export interface MissionStepContext {
  missionId: string;
  stepIndex: number;
  attempt: number;
  /** Sorties de TOUS les steps précédemment réussis, dans l'ordre — jamais les tentatives échouées. */
  priorOutputs: unknown[];
  input: unknown;
  cancelRequested(): Promise<boolean>;
  heartbeat(): Promise<void>;
}

export interface MissionStepResult {
  output: unknown;
  artifacts?: Array<{ kind: JobArtifactKind; storageRef: string; meta?: Record<string, unknown> }>;
  provider?: string;
  model?: string;
  costUsd?: number;
  tokensIn?: number;
  tokensOut?: number;
}

export interface MissionStepDefinition {
  name: string;
  run(ctx: MissionStepContext): Promise<MissionStepResult>;
}

/**
 * Bornes de sécurité d'UNE mission (§6 de la commande PHASE 3 : "chaque
 * mission : workspace isolé + budget + timeout + allowed tools + cleanup").
 * Toujours REQUISES à la création — jamais un défaut implicite non déclaré.
 */
export interface MissionSecurityBudget {
  /** Préfixes de chemin (relatifs à la racine du dépôt) que edit/create peuvent toucher — liste blanche, jamais un accès large par défaut. */
  allowedPathPrefixes: string[];
  /** Coût USD cumulé maximal (appels modèle) avant arrêt forcé de la mission. */
  maxCostUsd: number;
  /** Nombre maximal d'itérations de la boucle FIX (edit→verify) — NO BLIND LOOP. */
  maxFixIterations: number;
  /** Timeout, en ms, par opération d'exécution (typecheck/lint/test/build) — voir operations.ts. */
  operationTimeoutMs: number;
}

/** Sortie structurée du Visual Reviewer/Critic — voir vision.ts. Jamais un jugement en texte libre non parsé. */
export interface VisualCriticIssue {
  description: string;
  severity: "low" | "medium" | "high" | "blocker";
  evidence: string;
  recommendedFix: string;
}

export interface VisualCriticReport {
  overallPass: boolean;
  issues: VisualCriticIssue[];
}

/**
 * PHASE 5 (suite) — §30/§201 "multi-viewport natif" (06/09/2026).
 *
 * Jusqu'ici les largeurs multiples (desktop 1440px, mobile 390px) n'étaient
 * capturées que par un script ponctuel externe
 * (`scripts/capture-before-after-screenshots.ts`, voir gauntlet/corpus.ts,
 * cas "storefront_candidate_vs_production_before_after") — JAMAIS par la
 * boucle verify_and_fix elle-même. `CODER_VIEWPORTS` rend ça NATIF : chaque
 * tentative de vérification capture et fait réviser une capture d'écran
 * réelle à CHACUNE de ces largeurs, jamais une seule capture desktop
 * supposée représentative du responsive.
 */
export interface ViewportSpec {
  name: string;
  width: number;
  height: number;
}

export const CODER_VIEWPORTS: ViewportSpec[] = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 834, height: 1194 },
  { name: "mobile", width: 390, height: 844 },
];
