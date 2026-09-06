import { z } from "zod";
import type { ModelProvider } from "@/lib/ai/providers/provider";
import { chooseModel } from "@/lib/ai/models/router";
import { estimateCostUsd } from "@/lib/ai/models/cost";
import type { SpecialistContract, SpecialistOutput } from "@/lib/ai/supervisor/types";

/**
 * ONDEAL AI CORE — PHASE 4 : spécialistes réels (06/09/2026), §6/§7/§8.
 *
 * §16 réutilisé : chaque type de décision a son propre task set, routé via
 * `chooseModel()` (PHASE 2) — jamais un modèle forcé en dur. Sortie
 * TOUJOURS validée par zod (§7 : "éviter les longs textes libres lorsque
 * des structures machine-readable sont préférables") — un JSON non
 * conforme lève, jamais un verdict inventé (même principe que
 * coder/vision.ts::reviewScreenshot).
 */

export const PLANNING_TASK_SET = "storefront_planning_v1";
export const ANALYSIS_TASK_SET = "storefront_analysis_v1";
export const CREATIVE_DIRECTION_TASK_SET = "storefront_creative_direction_v1";
export const SYNTHESIS_TASK_SET = "storefront_synthesis_v1";
export const CRITIC_TASK_SET = "storefront_critic_v1";
export const JUDGE_TASK_SET = "storefront_judge_v1";

const planNodeSchema = z.object({
  key: z.string().min(1),
  role: z.string().min(1),
  dependsOn: z.array(z.string()),
  objective: z.string().min(1),
});
export const planSchema = z.object({ nodes: z.array(planNodeSchema).min(1).max(20) });

const analysisDataSchema = z.object({}).passthrough(); // trouvailles libres par rôle — la structure findings/evidence/recommendations (niveau SpecialistOutput) est déjà la contrainte machine-readable

const creativeDirectionSchema = z.object({
  id: z.string().min(1),
  strategy: z.string().min(1),
  story: z.string().min(1),
  hierarchy: z.string().min(1),
  visualPhilosophy: z.string().min(1),
  commerceReasoning: z.string().min(1),
});
export const creativeDirectionsSchema = z.object({ directions: z.array(creativeDirectionSchema).min(1).max(4) });

export const synthesisDataSchema = z.object({
  selection: z.enum(["SINGLE", "SYNTHESIZED"]),
  selectedDirectionId: z.string().min(1),
  combinedFromIds: z.array(z.string()).optional(),
  reasoning: z.string().min(1),
  finalBrief: z.object({
    strategy: z.string().min(1),
    story: z.string().min(1),
    hierarchy: z.string().min(1),
    visualPhilosophy: z.string().min(1),
    commerceReasoning: z.string().min(1),
  }),
});

export const criticDataSchema = z.object({
  verdict: z.enum(["PASS", "NEEDS_FIX", "REJECT"]),
  blockingIssues: z.array(z.string()),
  weaknesses: z.array(z.string()),
  rejectionCase: z.string().min(1), // §38 : "WHY SHOULD THIS CANDIDATE BE REJECTED?" — réponse OBLIGATOIRE même si le verdict est PASS
});

export const judgeDataSchema = z.object({
  verdict: z.enum(["READY_FOR_RELEASE", "FIX_REQUIRED", "REJECTED"]),
  justification: z.string().min(1),
  evidenceReviewed: z.array(z.string()),
});

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1]! : text;
  try {
    return JSON.parse(candidate.trim());
  } catch {
    throw new Error(`Sortie spécialiste : pas un JSON valide — refus (jamais un verdict inventé). Texte reçu : ${text.slice(0, 300)}`);
  }
}

export interface StructuredSpecialistResult<T> {
  output: SpecialistOutput & { data: T };
  provider: string;
  model: string;
  costUsd?: number;
  /** null si le provider ne rapporte pas les tokens réels — jamais fabriqué (même règle que GenerateResult, provider.ts). */
  tokensIn: number | null;
  tokensOut: number | null;
}

const specialistEnvelopeSchema = z.object({
  findings: z.array(z.string()),
  evidence: z.array(z.string()),
  uncertainties: z.array(z.string()),
  recommendations: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  data: z.unknown(),
});

/**
 * Appel structuré générique — réutilisé par tous les rôles. `dataSchema`
 * valide le champ `data` spécifique au rôle ; l'enveloppe (findings/
 * evidence/uncertainties/recommendations/confidence) est TOUJOURS la même
 * (§7). Lève explicitement si non conforme — jamais une valeur par défaut.
 */
export async function callStructuredSpecialist<T>(
  provider: ModelProvider,
  taskSetName: string,
  system: string,
  userMessage: string,
  dataSchema: z.ZodType<T>,
  maxTokens = 2000,
): Promise<StructuredSpecialistResult<T>> {
  const choice = await chooseModel(taskSetName);
  const result = await provider.generate({ model: choice.model, system, userMessage, maxTokens });
  const parsed = extractJson(result.text);
  const envelope = specialistEnvelopeSchema.safeParse(parsed);
  if (!envelope.success) {
    throw new Error(`Sortie spécialiste non conforme à l'enveloppe attendue (findings/evidence/uncertainties/recommendations/confidence/data) : ${envelope.error.message}`);
  }
  const dataResult = dataSchema.safeParse(envelope.data.data);
  if (!dataResult.success) {
    throw new Error(`Champ "data" non conforme au schéma du rôle "${taskSetName}" : ${dataResult.error.message}`);
  }
  // estimateCostUsd attend le PROVIDER réel (pour appeler .capabilities()),
  // jamais la chaîne `choice.provider` — bug corrigé : cohérent avec
  // coder/vision.ts::reviewScreenshot qui appelle `estimateCostUsd(provider, ...)`.
  const costUsd = estimateCostUsd(provider, choice.model, result.tokensIn, result.tokensOut);
  return {
    output: { ...envelope.data, data: dataResult.data },
    provider: choice.provider,
    model: choice.model,
    costUsd: costUsd ?? undefined,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
  };
}

/** Prompt système générique pour un rôle "analyste" (§6/§21) — un seul task set, paramétré par rôle plutôt que dupliqué N fois. */
export function analystSystemPrompt(role: string, focus: string): string {
  return `Tu es le spécialiste "${role}" d'OnDeal AI (Supervisor, PHASE 4). Analyse le contexte fourni selon cet angle : ${focus}. Réponds STRICTEMENT en JSON : {"findings":[...],"evidence":[...],"uncertainties":[...],"recommendations":[...],"confidence":0-1,"data":{}}. "evidence" doit citer des éléments RÉELS du contexte fourni (jamais une généralité sans ancrage). "uncertainties" doit lister explicitement ce qui manque plutôt que d'être vide par complaisance (§15). Aucun dark pattern (§21). Aucun chiffre de conversion inventé (§20/§77).`;
}

export { analysisDataSchema };
