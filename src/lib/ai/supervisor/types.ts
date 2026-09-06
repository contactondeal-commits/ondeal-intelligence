import type { JobArtifactKind } from "@/lib/ai/jobs/types";

/**
 * ONDEAL AI CORE — PHASE 4 : Supervisor / graphe d'exécution dynamique (06/09/2026).
 *
 * §7 de la commande ("SPECIALIST CONTRACT") : chaque spécialiste reçoit un
 * contrat structuré et retourne une sortie structurée — jamais un long texte
 * libre lorsqu'un schéma machine-readable suffit. §15 ("UNCERTAINTY") :
 * `confidence` et `uncertainties` existent précisément pour que le système
 * puisse dire UNKNOWN/INSUFFICIENT_DATA plutôt que d'inventer une certitude.
 */

/** Provenance d'un fait du World State (§14) — jamais un fait sans origine traçable. */
export type FactSource =
  | "SHOPIFY"
  | "GA4"
  | "JUDGEME"
  | "CJ"
  | "BROWSER"
  | "DOM"
  | "VISION"
  | "REPOSITORY"
  | "INTERNAL_DATABASE"
  | "EXTERNAL_RESEARCH"
  | "MODEL_INFERENCE"
  // PHASE 5 (06/09/2026) — AI Lab Ultimate : provenance d'un fait extrait
  // d'un fichier joint par l'owner (pipeline attachments/parse.ts), jamais
  // confondu avec INTERNAL_DATABASE (donnée OnDeal) ni EXTERNAL_RESEARCH
  // (web) — un fichier fourni par l'owner est une troisième provenance
  // distincte.
  | "USER_ATTACHMENT";

/** §14 : distinguer FACT / INFERENCE / HYPOTHESIS / OPINION — jamais mélangés silencieusement. */
export type FactKind = "FACT" | "INFERENCE" | "HYPOTHESIS" | "OPINION";

export interface WorldFact {
  key: string;
  value: unknown;
  kind: FactKind;
  source: FactSource;
  /** §15 : présent uniquement si la donnée est absente/insuffisante — jamais fabriqué pour paraître complet. */
  uncertainty?: "UNKNOWN" | "INSUFFICIENT_DATA" | "CONFLICTING_EVIDENCE" | "LOW_CONFIDENCE";
  note?: string;
}

/** §13 : WorldState structuré — le Supervisor raisonne dessus, jamais uniquement sur du texte conversationnel. */
export interface WorldState {
  builtAt: string; // ISO
  facts: WorldFact[];
}

/** §7 : contrat reçu par un spécialiste. */
export interface SpecialistContract {
  role: string;
  objective: string;
  context: Record<string, unknown>;
  allowedTools: string[];
  budget: { maxCostUsd: number };
  /** Nom du schéma zod attendu en sortie — validé par specialists.ts, jamais un texte libre non vérifié. */
  outputSchemaName: string;
}

/** §7 : sortie retournée par un spécialiste — structure fixe, jamais un texte libre à la place. */
export interface SpecialistOutput {
  findings: string[];
  evidence: string[];
  uncertainties: string[];
  recommendations: string[];
  confidence: number; // 0-1
  /** Données structurées spécifiques au rôle (ex. directions créatives, verdict critic/judge) — validées par le schéma zod du rôle. */
  data: unknown;
}

export type NodeStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "SKIPPED";

/** Un node du graphe (§5) — jamais un index linéaire fixe comme CoderMissionStep. */
export interface GraphNodeSpec {
  key: string;
  role: string;
  dependsOn: string[];
  contract: SpecialistContract;
}

export interface NodeExecutionResult {
  output: SpecialistOutput;
  provider?: string;
  model?: string;
  costUsd?: number;
  tokensIn?: number;
  tokensOut?: number;
  artifacts?: Array<{ kind: JobArtifactKind; storageRef: string; meta?: Record<string, unknown> }>;
}

/**
 * Exécuteur d'un rôle de spécialiste — reçoit le contrat + un accès en
 * lecture au graphe déjà exécuté (pour composer sur les sorties d'autres
 * nodes), peut RÉPLANIFIER en retournant `additionalNodes` (§5 : le graphe
 * doit pouvoir évoluer pendant la mission — jamais un plan figé au démarrage).
 */
export interface SpecialistExecutor {
  (ctx: {
    contract: SpecialistContract;
    getNodeOutput(key: string): SpecialistOutput | undefined;
    worldState: WorldState;
    workspaceRoot: string; // workspace Coder Agent réutilisé (Phase 3) pour cette mission — jamais le dépôt réel
  }): Promise<NodeExecutionResult & { additionalNodes?: GraphNodeSpec[] }>;
}
