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
// PHASE 5 (06/09/2026) — AI Lab Ultimate, §"Web Research"/"Data Analysis" :
// deux nouveaux rôles ouverts, mêmes conventions (task set dédié pour le
// Router §16, jamais un modèle forcé en dur).
export const RESEARCH_TASK_SET = "ai_lab_research_v1";
export const DATA_ANALYSIS_TASK_SET = "ai_lab_data_analysis_v1";

const planNodeSchema = z.object({
  key: z.string().min(1),
  role: z.string().min(1),
  dependsOn: z.array(z.string()),
  objective: z.string().min(1),
  // PHASE 5 (06/09/2026) — généralisation goal-agnostic (§178) : seuls
  // pertinents pour un node "coder_implementation" (buildCoderMissionSteps,
  // Phase 3, RÉUTILISÉ SANS MODIFICATION, exige previewPath/pageDescription
  // — jamais rendus optionnels côté steps.ts). Optionnels ici : ignorés pour
  // tout autre rôle, jamais une valeur par défaut fictive appliquée à un
  // rôle qui n'en a pas besoin.
  previewPath: z.string().min(1).optional(),
  pageDescription: z.string().min(1).optional(),
  // §"Data Analysis" : requête de calcul déterministe optionnelle, portée
  // par le node "data_analyst" — jamais interprétée par un autre rôle.
  dataQuery: z
    .object({ metricKeyPrefix: z.string().min(1), operation: z.enum(["sum", "avg", "min", "max", "count", "delta"]) })
    .optional(),
});
export const planSchema = z.object({ nodes: z.array(planNodeSchema).min(1).max(20) });

/**
 * §10 "ADD INSTRUCTION DURING MISSION" (06/09/2026) — variante de planSchema
 * pour la réplanification déclenchée par une instruction Owner en cours de
 * mission (graphRunner.ts::planNodesForInstruction) : `dependsOn` n'a pas de
 * sens ici (ces nodes démarrent toujours immédiatement, jamais rattachés à
 * une clé du graphe existant — voir la justification dans graphRunner.ts) et
 * `.min(0)` (jamais `.min(1)`) parce qu'une instruction peut légitimement ne
 * demander AUCUN travail supplémentaire (ex. simple clarification déjà
 * couverte) — un plan vide est une réponse honnête, jamais un node fabriqué
 * pour paraître réactif.
 */
const instructionPlanNodeSchema = planNodeSchema.omit({ dependsOn: true });
export const instructionPlanSchema = z.object({ nodes: z.array(instructionPlanNodeSchema).min(0).max(10) });

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

/**
 * §51 "Experiment Mode" (06/09/2026) réutilise ce même parseur strict pour
 * noter une variante (voir experiments/run.ts::scoreVariantOutput) — exporté
 * plutôt que dupliqué : "un JSON non conforme lève, jamais une donnée
 * inventée" doit rester une SEULE implémentation, jamais deux logiques de
 * parsing JSON qui pourraient diverger silencieusement.
 */
/**
 * CORRECTIF (06/09/2026, bug de production réel — 3e panne de la même
 * chaîne, cette fois révélée par un VRAI appel LLM une fois la clé
 * Anthropic configurée) : l'ancienne implémentation appliquait un regex de
 * fence NON ANCRÉ (`/```(?:json)?\s*([\s\S]*?)```/`, sans `^`/`$`), donc
 * capable de "trouver" un bloc fence n'importe où dans le texte — y compris
 * au milieu de prose, ce qui reviendrait à extraire un verdict d'une
 * réponse qui n'est PAS strictement structurée (contraire à "jamais
 * transformer une réponse prose en verdict"). Et surtout : un fence OUVERT
 * mais jamais refermé (signature d'une réponse tronquée par la limite de
 * tokens, max_tokens, avant la fin du JSON) ne matchait PAS du tout ce
 * regex (qui exige les DEUX fences) — le candidat retombait alors sur le
 * texte brut englobant encore les backticks d'ouverture, qui échoue
 * `JSON.parse` pour deux raisons à la fois (backticks + JSON incomplet),
 * sans jamais le dire clairement dans le message d'erreur.
 *
 * Nouvelle implémentation, dans cet ordre, JAMAIS un abandon silencieux ni
 * une réparation/invention de JSON :
 *   1. JSON brut (sans fence) — le cas le plus courant.
 *   2. EXACTEMENT un bloc fence Markdown FERMÉ, sans rien avant/après
 *      (```json ... ``` ou ``` ... ```) — ancré sur l'ENSEMBLE du texte
 *      trimé : une réponse "prose + JSON mélangés" (fence ou non) est donc
 *      TOUJOURS refusée, jamais extraite "au hasard".
 *   3. Fence OUVERT mais jamais refermé — on retire UNIQUEMENT le marqueur
 *      d'ouverture (jamais une tentative de deviner/compléter la suite),
 *      on retente un parsing standard, et l'erreur en cas d'échec NOMME
 *      explicitement la troncature probable — jamais à deviner après coup.
 *   4. Sinon : refus explicite (couvre aussi bien le JSON syntaxiquement
 *      invalide que la prose mélangée à du JSON sans fence).
 * L'aperçu du texte reçu dans le message d'erreur est porté à 2000
 * caractères (au lieu de 300) — suffisant pour voir la coupure réelle d'une
 * troncature, jamais juste le tout début.
 */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const preview = () => text.slice(0, 2000);

  // 1. JSON brut, sans fence Markdown.
  try {
    return JSON.parse(trimmed);
  } catch {
    // continue vers les formes fence ci-dessous — jamais un abandon silencieux ici.
  }

  // 2. Exactement un bloc fence Markdown fermé — rien avant/après.
  const closedFence = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/);
  if (closedFence) {
    const inner = closedFence[1]!.trim();
    try {
      return JSON.parse(inner);
    } catch {
      throw new Error(
        `Sortie spécialiste : bloc Markdown fermé détecté mais son contenu n'est pas un JSON valide — refus (jamais un verdict inventé/réparé). Texte reçu (2000 premiers caractères) : ${preview()}`,
      );
    }
  }

  // 3. Fence ouvert, jamais refermé — signature typique d'une réponse
  //    tronquée par max_tokens avant la fin du JSON.
  if (trimmed.startsWith("```")) {
    const withoutOpenMarker = trimmed.replace(/^```(?:json)?\s*\n?/, "");
    const looksUnclosed = !withoutOpenMarker.includes("```");
    try {
      return JSON.parse(withoutOpenMarker.trim());
    } catch {
      const hint = looksUnclosed
        ? " Le bloc Markdown n'est JAMAIS refermé dans la réponse reçue — signature typique d'une réponse TRONQUÉE PAR LA LIMITE DE TOKENS (max_tokens) avant la fin du JSON : augmenter maxTokens pour ce rôle est le correctif attendu, jamais une réparation du JSON partiel."
        : "";
      throw new Error(`Sortie spécialiste : pas un JSON valide — refus (jamais un JSON deviné/réparé).${hint} Texte reçu (2000 premiers caractères) : ${preview()}`);
    }
  }

  // 4. Ni JSON brut valide, ni fence — refus explicite (JSON syntaxiquement
  //    invalide, ou prose mélangée à du JSON sans fence).
  throw new Error(`Sortie spécialiste : pas un JSON valide — refus (jamais un verdict inventé). Texte reçu (2000 premiers caractères) : ${preview()}`);
}

export interface StructuredSpecialistResult<T> {
  output: SpecialistOutput & { data: T };
  provider: string;
  model: string;
  costUsd?: number;
  /** null si le provider ne rapporte pas les tokens réels — jamais fabriqué (même règle que GenerateResult, provider.ts). */
  tokensIn: number | null;
  tokensOut: number | null;
  /** PHASE 5 (§"Web Research") : citations RÉELLES renvoyées par le provider (jamais une URL inventée) — vide si webSearch n'a pas été demandé ou n'a rien retourné. */
  citations: Array<{ url: string; title: string | null }>;
  /**
   * §22-32 "provider continuity" (06/09/2026) : présent uniquement quand
   * `provider` est un composite (FailoverProvider) qui a dû essayer
   * plusieurs candidats — jamais un fallback muet (§32). Absent (undefined)
   * quand le premier candidat a servi du premier coup, ou quand `provider`
   * n'est pas un composite.
   */
  failoverAttempts?: Array<{ provider: string; model: string; failureCategory: string; message: string }>;
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
  /** PHASE 5 (§"Web Research") : active la recherche web native du provider (ONDEAL_ENABLE_WEB_SEARCH côté anthropic.ts) — jamais activée par défaut pour un rôle qui n'en a pas besoin. */
  webSearch?: { maxUses: number },
): Promise<StructuredSpecialistResult<T>> {
  const choice = await chooseModel(taskSetName);
  const result = await provider.generate({ model: choice.model, system, userMessage, maxTokens, webSearch });
  // §22-32 : `result.servedBy` n'est renseigné QUE par un composite
  // (FailoverProvider) — il reflète le candidat qui a RÉELLEMENT répondu,
  // qui peut différer de `choice` (chooseModel() ne connaît qu'un seul
  // catalogue, jamais les candidats de failover). Ne JAMAIS rapporter
  // `choice.provider`/`choice.model` quand `servedBy` dit autre chose —
  // ce serait un mensonge d'observabilité (§21 "MISSION BELONGS TO ONDEAL",
  // §32 "jamais un fallback muet").
  const actualProvider = result.servedBy?.provider ?? choice.provider;
  const actualModel = result.servedBy?.model ?? choice.model;
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
  // estimateCostUsd a besoin des capabilities du candidat qui a RÉELLEMENT
  // servi (coût par million de tokens diffère selon le provider/modèle) —
  // `provider.capabilities(actualModel)` résout correctement même quand
  // `provider` est un composite FailoverProvider (il cherche parmi SES
  // candidats le modèle qui correspond à `actualModel`, voir failover.ts).
  const costUsd = estimateCostUsd(provider, actualModel, result.tokensIn, result.tokensOut);
  return {
    output: { ...envelope.data, data: dataResult.data },
    provider: actualProvider,
    model: actualModel,
    costUsd: costUsd ?? undefined,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    citations: result.citations,
    failoverAttempts: result.failoverAttempts,
  };
}

/** Prompt système générique pour un rôle "analyste" (§6/§21) — un seul task set, paramétré par rôle plutôt que dupliqué N fois. */
export function analystSystemPrompt(role: string, focus: string): string {
  return `Tu es le spécialiste "${role}" d'OnDeal AI (Supervisor, PHASE 4). Analyse le contexte fourni selon cet angle : ${focus}. Réponds STRICTEMENT en JSON : {"findings":[...],"evidence":[...],"uncertainties":[...],"recommendations":[...],"confidence":0-1,"data":{}}. "evidence" doit citer des éléments RÉELS du contexte fourni (jamais une généralité sans ancrage). "uncertainties" doit lister explicitement ce qui manque plutôt que d'être vide par complaisance (§15). Aucun dark pattern (§21). Aucun chiffre de conversion inventé (§20/§77).`;
}

export { analysisDataSchema };
