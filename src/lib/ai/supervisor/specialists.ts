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
/**
 * §"BRIÈVETÉ" — CORRECTIF ARCHITECTURAL (06/09/2026, 5e panne réelle,
 * couche d'exécution des spécialistes après le correctif du planner) :
 * SOURCE UNIQUE de la contrainte de longueur imposée à TOUS les rôles
 * (planner ET catalogue de spécialistes, catalogue.ts) — jamais une consigne
 * de brièveté réécrite à la main dans chaque prompt (ce qui a déjà dérivé
 * silencieusement une fois : le planner l'imposait, aucun rôle de
 * catalogue.ts ne le faisait, d'où la 5e panne). "data" reste désigné comme
 * la seule partie réellement exploitée par le code — jamais sacrifiée à une
 * prose longue dans findings/evidence.
 */
export const CONCISE_ENVELOPE_INSTRUCTION =
  `IMPÉRATIF DE BRIÈVETÉ (cause réelle de plusieurs troncatures de production précédentes) : "findings" = AU PLUS 3 phrases courtes (une ligne chacune, jamais un paragraphe). "evidence" = AU PLUS 3 éléments courts (une ligne chacun — pas d'objet détaillé avec justification longue). "uncertainties"/"recommendations" = 0 à 3 éléments courts. Le champ "data" est la seule partie réellement exploitée par le code — ne JAMAIS laisser findings/evidence consommer le budget de sortie au détriment d'un "data" complet et correctement fermé en JSON.`;

/**
 * §"INTÉGRITÉ JSON" — CORRECTIF ARCHITECTURAL (06/09/2026, 6e panne réelle) :
 * une nouvelle exécution réelle en production a échoué avec "bloc Markdown
 * fermé détecté mais son contenu n'est pas un JSON valide" — DIFFÉRENT des
 * pannes 4/5 (troncature par max_tokens) : le bloc fence était bien FERMÉ
 * (```...```, ancré sur l'ENSEMBLE du texte — voir extractJson) et le
 * `stop_reason` réel du provider pour cette réponse N'ÉTAIT PAS "max_tokens"
 * (sinon la reprise dédiée à la troncature, ci-dessous, aurait DÉJÀ
 * intercepté le cas AVANT extractJson) — le modèle a donc terminé sa
 * génération de lui-même en produisant un JSON syntaxiquement invalide,
 * jamais une coupure de budget. Cause la plus plausible, compte tenu du
 * contenu réellement injecté dans les prompts (World State/évidence
 * pretty-printé via JSON.stringify, cf. factsBlock/graphRunner.ts) : le
 * modèle recopie un extrait brut (guillemets, retours à la ligne, structure
 * imbriquée) directement dans une chaîne "findings"/"evidence"/"objective"
 * sans le ré-échapper correctement — un piège d'échappement JSON connu,
 * jamais une supposition à l'aveugle ici : cette instruction attaque
 * directement la cause la plus probable (jamais recopier tel quel), et
 * l'erreur levée par extractJson (voir plus bas) rapporte désormais le
 * `stop_reason` réel ET le message exact de JSON.parse — jamais swallow —
 * pour confirmer/infirmer cette hypothèse sur la prochaine exécution réelle.
 */
export const JSON_INTEGRITY_INSTRUCTION =
  `IMPÉRATIF D'INTÉGRITÉ JSON (cause probable d'un échec de production réel) : ne JAMAIS copier un extrait brut (guillemets, retours à la ligne, accolades) du World State ou d'une pièce jointe directement à l'intérieur d'une chaîne "findings"/"evidence"/"objective"/"uncertainties"/"recommendations" — PARAPHRASE toujours en prose simple, sans guillemets ni structure imbriquée non échappée. Une seule chaîne mal échappée invalide l'ENSEMBLE de la réponse JSON — jamais un raccourci qui vaille la peine.`;

/**
 * CORRECTIF ARCHITECTURAL (06/09/2026, 5e panne réelle) : plafond de reprise
 * — largement sous la limite officielle de sortie de claude-haiku-4-5 (64 000
 * tokens, cf. platform.claude.com/docs/en/models/haiku-4-5/overview, vérifié
 * le 06/09/2026, §57 jamais un chiffre deviné). Une seule reprise est
 * tentée (voir callStructuredSpecialist) — jamais une boucle non bornée.
 */
const MAX_RETRY_TOKENS = 16_000;

/**
 * CORRECTIF ARCHITECTURAL (06/09/2026, 6e panne réelle) : `stopReason` ajouté
 * en second paramètre — jamais utilisé pour DÉCIDER quoi que ce soit ici
 * (extractJson reste un pur parseur, la décision de reprise reste dans
 * callStructuredSpecialist), UNIQUEMENT pour l'INCLURE, tel quel, dans
 * chaque message d'erreur — jusqu'ici totalement absent des messages
 * d'échec, alors que c'est le SEUL signal qui distingue "troncature
 * confirmée par le budget de tokens" de "réponse terminée normalement mais
 * syntaxiquement invalide" (la 6e panne réelle est de cette seconde
 * catégorie). Chaque `catch` capture aussi désormais le message RÉEL de
 * `JSON.parse` (auparavant swallow silencieusement, §"ne jamais masquer
 * l'erreur") — la position exacte qu'il rapporte (ex. "Unexpected token ...
 * at position N") est la preuve la plus directe de la cause exacte.
 */
export function extractJson(text: string, stopReason?: string | null): unknown {
  const trimmed = text.trim();
  const preview = () => text.slice(0, 2000);
  const stopReasonNote = `stop_reason réel du provider pour cette réponse : "${stopReason ?? "non rapporté"}"`;

  // 1. JSON brut, sans fence Markdown.
  let rawParseError: string | null = null;
  try {
    return JSON.parse(trimmed);
  } catch (err) {
    rawParseError = err instanceof Error ? err.message : String(err);
    // continue vers les formes fence ci-dessous — jamais un abandon silencieux ici.
  }

  // 2. Exactement un bloc fence Markdown fermé — rien avant/après.
  const closedFence = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/);
  if (closedFence) {
    const inner = closedFence[1]!.trim();
    try {
      return JSON.parse(inner);
    } catch (err) {
      const parseErrMessage = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Sortie spécialiste : bloc Markdown fermé détecté mais son contenu n'est pas un JSON valide — refus (jamais un verdict inventé/réparé). ${stopReasonNote} (≠ "max_tokens" attendu ici signifierait une réponse terminée normalement mais syntaxiquement invalide, PAS une troncature de budget). Erreur JSON.parse exacte : ${parseErrMessage}. Texte reçu (2000 premiers caractères) : ${preview()}`,
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
    } catch (err) {
      const parseErrMessage = err instanceof Error ? err.message : String(err);
      const hint = looksUnclosed
        ? " Le bloc Markdown n'est JAMAIS refermé dans la réponse reçue — signature typique d'une réponse TRONQUÉE PAR LA LIMITE DE TOKENS (max_tokens) avant la fin du JSON : augmenter maxTokens pour ce rôle est le correctif attendu, jamais une réparation du JSON partiel."
        : "";
      throw new Error(
        `Sortie spécialiste : pas un JSON valide — refus (jamais un JSON deviné/réparé).${hint} ${stopReasonNote}. Erreur JSON.parse exacte : ${parseErrMessage}. Texte reçu (2000 premiers caractères) : ${preview()}`,
      );
    }
  }

  // 4. Ni JSON brut valide, ni fence — refus explicite (JSON syntaxiquement
  //    invalide, ou prose mélangée à du JSON sans fence).
  throw new Error(
    `Sortie spécialiste : pas un JSON valide — refus (jamais un verdict inventé). ${stopReasonNote}. Erreur JSON.parse exacte (tentative brute) : ${rawParseError}. Texte reçu (2000 premiers caractères) : ${preview()}`,
  );
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
  // CORRECTIF ARCHITECTURAL (06/09/2026, 5e panne réelle) : défaut relevé de
  // 2000 à 4000 — plusieurs rôles du catalogue (analyst(), dataAnalyst)
  // n'ont JAMAIS passé de maxTokens explicite et retombaient donc sur cet
  // ancien défaut, largement insuffisant même avec la contrainte de
  // brièveté ci-dessus (CONCISE_ENVELOPE_INSTRUCTION) appliquée. Reste une
  // marge de sécurité — la protection réelle contre la troncature est
  // désormais la détection stop_reason + reprise contrôlée ci-dessous,
  // jamais un chiffre seul.
  maxTokens = 4000,
  /** PHASE 5 (§"Web Research") : active la recherche web native du provider (ONDEAL_ENABLE_WEB_SEARCH côté anthropic.ts) — jamais activée par défaut pour un rôle qui n'en a pas besoin. */
  webSearch?: { maxUses: number },
): Promise<StructuredSpecialistResult<T>> {
  const choice = await chooseModel(taskSetName);

  const attempt = (tokens: number, systemPrompt: string) => provider.generate({ model: choice.model, system: systemPrompt, userMessage, maxTokens: tokens, webSearch });

  let result = await attempt(maxTokens, system);
  // CORRECTIF ARCHITECTURAL (06/09/2026, 5e panne réelle) : chaque tentative
  // (y compris une première tentative tronquée et jetée) consomme des
  // tokens RÉELS et a un coût RÉEL — jamais silencieusement perdu au profit
  // du seul décompte de la tentative finale (ce serait un mensonge
  // d'observabilité, même principe que §22-32 pour servedBy). Agrégées
  // ci-dessous, jamais fabriquées quand un attempt ne rapporte pas ses
  // tokens (auquel cas le total redevient honnêtement `null`).
  const attemptsForTokens: Array<{ tokensIn: number | null; tokensOut: number | null }> = [result];

  // CORRECTIF ARCHITECTURAL (06/09/2026, 5e panne réelle — troncature de la
  // couche d'exécution des spécialistes, APRÈS le correctif du planner) :
  // détection DÉFINITIVE de la troncature via le signal RÉEL du provider
  // (stop_reason/finish_reason normalisé en "max_tokens", provider.ts),
  // jamais une heuristique déduite du texte reçu après coup (l'ancienne
  // approche côté extractJson — "fence Markdown jamais refermé" — reste en
  // place ci-dessous comme FILET DE SÉCURITÉ pour un provider qui ne
  // rapporterait pas ce signal, mais n'est plus la détection primaire).
  // Une SEULE reprise contrôlée est tentée — jamais une boucle non bornée,
  // jamais une réparation du JSON partiel déjà reçu : budget doublé
  // (plafonné à MAX_RETRY_TOKENS) + rappel explicite de concision.
  let retried = false;
  if (result.stopReason === "max_tokens") {
    const retryTokens = Math.min(maxTokens * 2, MAX_RETRY_TOKENS);
    const retrySystem = `${system}\n\n${CONCISE_ENVELOPE_INSTRUCTION}\n\nRAPPEL CRITIQUE : ta réponse précédente a été TRONQUÉE par la limite de tokens avant la fin du JSON (confirmé par le provider — stop_reason=max_tokens). Cette fois, réponds de façon NETTEMENT plus concise afin que le JSON complet, correctement fermé, tienne dans le budget alloué (${retryTokens} tokens) — jamais un JSON partiel, jamais une troncature répétée.`;
    result = await attempt(retryTokens, retrySystem);
    attemptsForTokens.push(result);
    retried = true;
    if (result.stopReason === "max_tokens") {
      throw new Error(
        `Sortie spécialiste tronquée par la limite de tokens (confirmé par le provider — stop_reason=max_tokens) MÊME APRÈS une reprise avec un budget doublé (${retryTokens} tokens) et une consigne de concision explicite — refus (jamais un JSON partiel réparé ou deviné). Texte reçu (2000 premiers caractères) : ${result.text.slice(0, 2000)}`,
      );
    }
  }

  /**
   * CORRECTIF ARCHITECTURAL (06/09/2026, 6e panne réelle) : une exécution
   * réelle en production a échoué avec "bloc Markdown fermé détecté mais
   * son contenu n'est pas un JSON valide" — le fence était bien FERMÉ et
   * `stop_reason` N'ÉTAIT PAS "max_tokens" (sinon la branche ci-dessus
   * aurait déjà agi AVANT d'atteindre extractJson) : donc PAS une
   * troncature confirmée par le budget de tokens, mais une réponse
   * terminée normalement et néanmoins syntaxiquement invalide (voir
   * JSON_INTEGRITY_INSTRUCTION ci-dessus pour la cause la plus probable).
   * L'ancien code laissait cette catégorie d'échec directement fatale,
   * SANS AUCUNE reprise (contrairement à la troncature par max_tokens) —
   * gap corrigé ici : UNE SEULE reprise supplémentaire est tentée, avec une
   * consigne explicite d'intégrité JSON, jamais une réparation du texte déjà
   * reçu (on redemande une réponse fraîche) — et JAMAIS une 2e reprise si la
   * troncature par max_tokens a DÉJÀ consommé la seule reprise autorisée
   * (`retried` déjà vrai) : toujours au plus UNE reprise par appel, quelle
   * que soit la cause, jamais une boucle non bornée.
   */
  let parsed: unknown;
  try {
    parsed = extractJson(result.text, result.stopReason);
  } catch (err) {
    if (retried) {
      throw new Error(
        `Sortie spécialiste : JSON toujours invalide même après la reprise déjà tentée pour troncature confirmée (stop_reason=max_tokens) — refus (jamais un JSON réparé/deviné, jamais une 2e reprise). ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const retryTokens = Math.min(maxTokens * 2, MAX_RETRY_TOKENS);
    const retrySystem = `${system}\n\n${CONCISE_ENVELOPE_INSTRUCTION}\n\n${JSON_INTEGRITY_INSTRUCTION}\n\nRAPPEL CRITIQUE : ta réponse précédente n'était PAS un JSON valide (stop_reason rapporté par le provider : "${result.stopReason ?? "non rapporté"}" — donc PAS une troncature confirmée par la limite de tokens : une erreur de format). Cette fois, produis un JSON strictement valide et correctement échappé, sans jamais recopier un extrait brut entre guillemets depuis le contexte fourni.`;
    result = await attempt(retryTokens, retrySystem);
    attemptsForTokens.push(result);
    retried = true;
    try {
      parsed = extractJson(result.text, result.stopReason);
    } catch (err2) {
      throw new Error(
        `Sortie spécialiste : JSON invalide MÊME APRÈS une reprise avec consigne explicite d'intégrité JSON — refus (jamais un JSON réparé/deviné, jamais une 2e reprise). Erreur avant reprise : ${err instanceof Error ? err.message : String(err)}. Erreur après reprise (stop_reason="${result.stopReason ?? "non rapporté"}") : ${err2 instanceof Error ? err2.message : String(err2)}`,
      );
    }
  }

  const totalTokensIn = attemptsForTokens.every((a) => a.tokensIn != null) ? attemptsForTokens.reduce((sum, a) => sum + a.tokensIn!, 0) : null;
  const totalTokensOut = attemptsForTokens.every((a) => a.tokensOut != null) ? attemptsForTokens.reduce((sum, a) => sum + a.tokensOut!, 0) : null;

  // §22-32 : `result.servedBy` n'est renseigné QUE par un composite
  // (FailoverProvider) — il reflète le candidat qui a RÉELLEMENT répondu,
  // qui peut différer de `choice` (chooseModel() ne connaît qu'un seul
  // catalogue, jamais les candidats de failover). Ne JAMAIS rapporter
  // `choice.provider`/`choice.model` quand `servedBy` dit autre chose —
  // ce serait un mensonge d'observabilité (§21 "MISSION BELONGS TO ONDEAL",
  // §32 "jamais un fallback muet"). Calculé ICI (après la résolution
  // complète de `parsed`, ci-dessus) — jamais avant : `result` peut avoir
  // été réassigné par la reprise d'intégrité JSON ci-dessus, un calcul
  // antérieur aurait rapporté le candidat de la tentative REJETÉE, jamais
  // celle qui a réellement fourni le JSON retenu (même piège que §22-32).
  const actualProvider = result.servedBy?.provider ?? choice.provider;
  const actualModel = result.servedBy?.model ?? choice.model;

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
  // CORRECTIF ARCHITECTURAL (06/09/2026, 5e panne réelle) : coût calculé sur
  // les tokens AGRÉGÉS de toutes les tentatives (totalTokensIn/Out) — jamais
  // seulement la tentative finale, qui ignorerait le coût bien réel d'une
  // première tentative tronquée puis jetée.
  const costUsd = estimateCostUsd(provider, actualModel, totalTokensIn, totalTokensOut);
  return {
    output: { ...envelope.data, data: dataResult.data },
    provider: actualProvider,
    model: actualModel,
    costUsd: costUsd ?? undefined,
    tokensIn: totalTokensIn,
    tokensOut: totalTokensOut,
    citations: result.citations,
    failoverAttempts: result.failoverAttempts,
  };
}

/**
 * Prompt système générique pour un rôle "analyste" (§6/§21) — un seul task
 * set, paramétré par rôle plutôt que dupliqué N fois.
 *
 * CORRECTIF ARCHITECTURAL (06/09/2026, 5e panne réelle) : intègre désormais
 * CONCISE_ENVELOPE_INSTRUCTION — ce prompt (utilisé par 5 des rôles du
 * catalogue : Brand/UX/CRO/Accessibilité/Performance, catalogue.ts) ne
 * bornait auparavant AUCUNE longueur pour findings/evidence, contrairement
 * au planner (déjà corrigé). C'est la cause racine exacte de la 5e panne de
 * production : le planner produisait des nodes, mais l'exécution de CES
 * rôles tronquait ensuite au même titre.
 */
export function analystSystemPrompt(role: string, focus: string): string {
  return `Tu es le spécialiste "${role}" d'OnDeal AI (Supervisor, PHASE 4). Analyse le contexte fourni selon cet angle : ${focus}. Réponds STRICTEMENT en JSON : {"findings":[...],"evidence":[...],"uncertainties":[...],"recommendations":[...],"confidence":0-1,"data":{}}. "evidence" doit citer des éléments RÉELS du contexte fourni (jamais une généralité sans ancrage). "uncertainties" doit lister explicitement ce qui manque plutôt que d'être vide par complaisance (§15). Aucun dark pattern (§21). Aucun chiffre de conversion inventé (§20/§77).\n${CONCISE_ENVELOPE_INSTRUCTION}\n${JSON_INTEGRITY_INSTRUCTION}`;
}

export { analysisDataSchema };
