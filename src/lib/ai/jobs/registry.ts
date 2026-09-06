import type { JobStepDefinition } from "@/lib/ai/jobs/types";
import { marginRiskSteps } from "@/lib/ai/jobs/tasks/marginRisk";

/**
 * ONDEAL AI JOB ENGINE — registre des plans d'exécution réels (06/09/2026).
 *
 * `Job.type` reste une string libre (voir schema.prisma) : POST /api/jobs
 * peut créer un job de N'IMPORTE QUEL type sans passer par ce fichier. Ce
 * registre ne couvre que la distinction CRÉER un job vs EXÉCUTER un job —
 * seul un type présent ici a un plan de steps réel que
 * POST /api/jobs/[id]/run peut lancer. Un type absent renvoie une erreur
 * explicite côté route, jamais une exécution silencieuse d'un plan vide.
 */
export interface JobPlan {
  steps: JobStepDefinition[];
}

const REGISTRY: Record<string, JobPlan> = {
  analyze_margin_risk: { steps: marginRiskSteps },
};

export function getJobPlan(type: string): JobPlan | null {
  return REGISTRY[type] ?? null;
}

export function listExecutableJobTypes(): string[] {
  return Object.keys(REGISTRY);
}
