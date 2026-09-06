/**
 * ONDEAL GAUNTLET — format de benchmark (06/09/2026), fondation §10.
 *
 * Interfaces et format SEULEMENT, comme demandé explicitement — aucun
 * exécuteur, aucun scoring automatisé, aucune intégration au Model Router.
 * Le corpus (corpus.ts) sert de première preuve que le format est
 * utilisable sur des tâches RÉELLES, pas une maquette.
 */

export type GauntletCategory =
  | "coding"
  | "architecture"
  | "debugging"
  | "tool_use"
  | "research"
  | "ux"
  | "ui"
  | "cro"
  | "ecommerce_reasoning"
  | "visual_quality"
  | "reliability"
  // PHASE 3 (§17) — catégories introduites par le Coder Agent (sandbox +
  // navigateur + vision), toutes déjà exemplifiées par au moins une tâche
  // RÉELLEMENT accomplie dans corpus.ts (jamais ajoutées à vide) :
  | "code_understanding"
  | "code_generation"
  | "test_repair"
  | "browser_navigation"
  | "visual_review"
  | "visual_fix";

export interface GauntletTask {
  id: string;
  category: GauntletCategory;
  /** Description factuelle de la tâche telle qu'elle s'est réellement présentée — jamais reformulée pour paraître plus « propre » qu'elle ne l'était. */
  description: string;
  /** D'où vient cette tâche — traçabilité obligatoire (voir RESEARCH BEFORE IMPLEMENTATION / jamais inventer). */
  source: string;
  /** Critère(s) de réussite vérifiable(s) — jamais un jugement subjectif seul à ce stade (visual_quality/ux/ui/cro n'ont pas encore de critère automatisable, voir corpus.ts). */
  expectedCriteria: string[];
}

export interface GauntletResult {
  taskId: string;
  provider: string;
  model: string;
  jobId: string | null;
  score: number; // 0-1
  passed: boolean;
  costUsd: number | null;
  durationMs: number | null;
  notes?: string;
  ranAt: string; // ISO
}
