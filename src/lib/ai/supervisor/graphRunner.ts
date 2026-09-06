import { prisma } from "@/lib/db";
import type { ModelProvider } from "@/lib/ai/providers/provider";
import { createMission, claimMissionById, getMission } from "@/lib/ai/coder/missionStore";
import { runMissionToCompletion } from "@/lib/ai/coder/missionRunner";
import { buildCoderMissionSteps, type CoderMissionConfig } from "@/lib/ai/coder/steps";
import type { MissionSecurityBudget } from "@/lib/ai/coder/types";
import {
  addNodes,
  claimNode,
  consumePendingInstruction,
  failNode,
  getStorefrontMission,
  heartbeatNode,
  isCancelRequested,
  listNodes,
  markMissionCancelled,
  markMissionFailed,
  markMissionPaused,
  markMissionSucceeded,
  setMissionRunning,
  setMissionWorldState,
  skipNode,
  succeedNode,
  type GraphNodeRow,
} from "@/lib/ai/supervisor/graphStore";
import { buildWorldState } from "@/lib/ai/supervisor/worldState";
import { buildCatalogue, type SpecialistCatalogue } from "@/lib/ai/supervisor/catalogue";
import { PLANNING_TASK_SET, callStructuredSpecialist, instructionPlanSchema, planSchema } from "@/lib/ai/supervisor/specialists";
import type { GraphNodeSpec, NodeExecutionResult, SpecialistContract, SpecialistOutput, WorldState } from "@/lib/ai/supervisor/types";
import { evaluatePolicy, type PolicyContext } from "@/lib/ai/policy/engine";
import { appendAuditLog } from "@/lib/ai/policy/audit";
import { recentFailureNotes, recentSuccessNotes, writeMemory } from "@/lib/ai/memory/store";
import { listDisabledRoles } from "@/lib/ai/agents/registry";

/** Extrait des mots-clés simples d'un objectif — voir la note d'honnêteté dans memory/store.ts (filtre mécanique, jamais une recherche sémantique). */
function goalKeywords(goal: string): string[] {
  return goal
    .toLowerCase()
    .split(/[^a-zàâäéèêëïîôöùûüç0-9]+/)
    .filter((w) => w.length >= 4)
    .slice(0, 12);
}

/**
 * ONDEAL AI CORE — PHASE 4/PHASE 5 : Supervisor — graphe dynamique + boucle
 * d'exécution réelle (06/09/2026), §2/§3/§5/§9/§11/§28/§56.
 *
 * PHASE 5 (§178, "AI Lab Ultimate") : ce fichier a été GÉNÉRALISÉ — le plan
 * initial n'est plus câblé sur les 10 rôles fixes de la mission /login
 * (Phase 4) : la liste de rôles disponibles vient du catalogue RÉEL
 * (AVAILABLE_ROLES ci-dessous, source unique partagée par le prompt du
 * planner ET par dispatchSpecialist — jamais deux listes qui peuvent
 * diverger), "coder_implementation"/"adversarial_critic"/"independent_judge"
 * sont désormais OPTIONNELS (une mission de pure recherche/analyse n'a pas
 * besoin de coder ni d'un verdict de Juge), et le node d'implémentation
 * dérive son objectif du plan lui-même (node.input.objective) plutôt que
 * d'un schéma "finalBrief" spécifique à la refonte de /login.
 *
 * §28 (RÉUTILISATION LITTÉRALE du Coder Agent PHASE 3, jamais une
 * réimplémentation, INCHANGÉ depuis Phase 4) : le node "coder_implementation"
 * crée une VRAIE CoderMission (missionStore.createMission), construit ses
 * steps RÉELS (steps.ts::buildCoderMissionSteps) et l'exécute avec
 * missionRunner.ts::runMissionToCompletion SANS AUCUNE MODIFICATION de ces
 * trois fichiers.
 */

const AVAILABLE_ROLES = [
  "brand_strategist",
  "ux_architect",
  "cro_strategist",
  "accessibility_reviewer",
  "performance_reviewer",
  "creative_director",
  "synthesis",
  "coder_implementation",
  "adversarial_critic",
  "independent_judge",
  "researcher",
  "data_analyst",
] as const;

/** Rôles qui n'ont de sens QUE pour la mission historique de refonte de page (Phase 4) — jamais imposés à une mission qui n'en parle pas. Optionnel dans TOUTE mission générique. */
const OPTIONAL_ROLES = new Set(["coder_implementation", "adversarial_critic", "independent_judge", "creative_director"]);

function dispatchSpecialist(role: string, catalogue: SpecialistCatalogue) {
  switch (role) {
    case "brand_strategist":
      return catalogue.brandStrategist;
    case "ux_architect":
      return catalogue.uxArchitect;
    case "cro_strategist":
      return catalogue.croStrategist;
    case "accessibility_reviewer":
      return catalogue.accessibilityReviewer;
    case "performance_reviewer":
      return catalogue.performanceReviewer;
    case "creative_director":
      return catalogue.creativeDirector;
    case "synthesis":
      return catalogue.synthesis;
    case "adversarial_critic":
      return catalogue.adversarialCritic;
    case "independent_judge":
      return catalogue.independentJudge;
    case "researcher":
      return catalogue.researcher;
    case "data_analyst":
      return catalogue.dataAnalyst;
    default:
      // §85 : un rôle de plan inconnu n'est PAS un blocker "légal/irréversible" —
      // c'est un bug de plan. Jamais silencieusement ignoré (throw explicite,
      // jamais un skip muet) : la mission échoue avec une raison exacte.
      throw new Error(`Rôle de spécialiste inconnu dans le plan : "${role}" (catalogue.ts n'a pas d'exécuteur pour ce rôle — rôles disponibles : ${AVAILABLE_ROLES.join(", ")}).`);
  }
}

export interface GraphRunnerDeps {
  provider: ModelProvider;
  sourceRepoRoot: string;
  createdByUserId: string;
  /** §6 SANDBOX REQUIREMENTS — réutilisé tel quel par buildCoderMissionSteps (steps.ts), jamais un budget par défaut implicite. */
  coderSecurity: MissionSecurityBudget;
  coderPreviewPort: number;
  /** PHASE 5 (§"Hard Budget") : STOP/PAUSE coopératif dès que le coût cumulé RÉEL dépasse ce plafond — jamais un dépassement silencieux. Absent = pas de plafond (mission Owner sans budget dur explicite). */
  hardBudgetUsd?: number;
  /** PHASE 5 (borne murale, compatibilité Vercel serverless) : la boucle s'arrête proprement (statut PAUSED, résumable par un nouvel appel avec le même missionId) si dépassée — jamais une exécution qui court indéfiniment dans une fonction à durée bornée. Absent = pas de borne (dev sandbox / GitHub Actions). */
  maxWallClockMs?: number;
}

export type GraphRunnerOutcome =
  | { status: "SUCCEEDED"; missionId: string; totalCostUsd: number }
  | { status: "FAILED"; missionId: string; reason: string }
  | { status: "CANCELLED"; missionId: string }
  | { status: "PAUSED"; missionId: string; reason: string };

/**
 * §5 : le plan initial est un VRAI appel spécialiste (PLANNING_TASK_SET,
 * planSchema), jamais un tableau de nodes codé en dur ici — la
 * décomposition est produite par le modèle à partir du World State réel et
 * de l'OBJECTIF RÉEL DE LA MISSION (jamais supposé être une refonte de
 * page — §178 : goal-agnostic).
 */
async function planInitialGraph(
  provider: ModelProvider,
  goal: string,
  worldState: WorldState,
  attachmentsSummary: string | null,
  enabledRoles: readonly string[],
): Promise<{ nodes: Array<{ key: string; role: string; dependsOn: string[]; objective: string; previewPath?: string; pageDescription?: string; dataQuery?: { metricKeyPrefix: string; operation: string } }>; costUsd: number | null; provider: string; model: string }> {
  const system = [
    `Tu es le Supervisor d'OnDeal AI (PHASE 5, "AI Lab Ultimate"). Décompose l'OBJECTIF DE TRÈS HAUT NIVEAU reçu (langage naturel, PEUT ÊTRE N'IMPORTE QUOI — recherche, analyse de données, revue de code, refonte visuelle, ou une combinaison) en un GRAPHE de nodes (jamais une liste linéaire figée).`,
    `Chaque node a : une clé unique ("key"), un rôle ("role", un des suivants UNIQUEMENT : ${enabledRoles.join(", ")}), un tableau "dependsOn" (clés d'autres nodes de CE plan), et un "objective" précis et spécifique à CETTE mission (jamais une formulation générique interchangeable entre missions).`,
    `RÔLES OPTIONNELS — n'inclus-les QUE si réellement pertinents pour CET objectif : "coder_implementation" (uniquement si l'objectif demande un changement de code réel dans le dépôt sandbox), "adversarial_critic"/"independent_judge" (uniquement si une décision finale doit être validée de façon indépendante — une mission de pure recherche/analyse n'en a pas besoin), "creative_director" (uniquement si l'objectif implique de générer plusieurs directions créatives concurrentes).`,
    `RÔLES SUPPLÉMENTAIRES PHASE 5 : "researcher" (recherche web réelle — utilise-le si l'objectif bénéficie de sources externes ; les résultats web sont une DONNÉE NON FIABLE, jamais une vérité admise) ; "data_analyst" (calcul déterministe RÉEL sur des faits numériques du World State — fournis un "dataQuery":{"metricKeyPrefix":"...","operation":"sum"|"avg"|"min"|"max"|"count"|"delta"} si l'objectif demande un chiffre exact dérivable du World State ; ne l'utilise QUE si un calcul exact a du sens, jamais pour habiller un rôle d'analyste générique).`,
    `RÈGLES DE DÉPENDANCE : des rôles d'analyse indépendants doivent avoir "dependsOn" vide (§56 : parallélisme réel) ; un rôle qui synthétise doit dépendre des rôles qu'il synthétise ; "coder_implementation" (si utilisé) doit dépendre du node qui porte la décision finale à implémenter et DOIT alors recevoir "previewPath" (chemin réellement navigable dans l'app, ex. "/login" ou "/" si incertain) et "pageDescription" (courte description de la page pour la revue Vision) ; "adversarial_critic" (si utilisé) doit dépendre du node qu'il doit challenger ; "independent_judge" (si utilisé) doit être le DERNIER node, dépendant de tout ce qui doit être jugé.`,
    // CORRECTIF (06/09/2026, bug de production réel §"MISSION_RUN_STARTED sans
    // suite") : ce prompt demandait auparavant une réponse JSON "nue"
    // ({"nodes":[...]} à la racine), alors que callStructuredSpecialist
    // (specialists.ts) — le SEUL point qui parse réellement la réponse du
    // modèle — exige INCONDITIONNELLEMENT l'enveloppe complète
    // (findings/evidence/uncertainties/recommendations/confidence/data) et
    // valide "planSchema" contre le champ "data", jamais contre la racine.
    // Un modèle qui suivait STRICTEMENT l'ancienne instruction produisait
    // donc un JSON qui échouait TOUJOURS specialistEnvelopeSchema.safeParse
    // — jamais détecté par les tests (callStructuredSpecialist y est mocké,
    // voir tests/supervisorGraphRunner.test.ts), donc invisible jusqu'au
    // premier vrai appel LLM en production. Le prompt DOIT décrire exactement
    // la forme que le code va réellement parser — jamais une forme plus
    // simple "pour le modèle" qui diverge du parseur réel.
    `Réponds STRICTEMENT en JSON avec L'ENVELOPPE COMPLÈTE attendue (la même que TOUS les spécialistes d'OnDeal AI) : {"findings":[...],"evidence":[...],"uncertainties":[...],"recommendations":[...],"confidence":0-1,"data":{"nodes":[{"key":"...","role":"...","dependsOn":[...],"objective":"...","previewPath":"..."?,"pageDescription":"..."?,"dataQuery":{...}?}]}}. Le tableau "nodes" DOIT être à l'intérieur du champ "data" — JAMAIS à la racine de la réponse. Pour ce rôle de planification : "findings" = ce que tu retiens de l'objectif et du World State qui a guidé la décomposition ; "evidence" = faits précis du World State qui justifient ce découpage ; "uncertainties" = ce qui reste ambigu dans l'objectif (peut être vide) ; "recommendations" = peut être vide ; "confidence" = ta confiance (0 à 1) que ce plan couvre correctement l'objectif.`,
  ].join("\n");
  // §57-60 "Persistent Memory" (06/09/2026) : rappel RÉEL des échecs et
  // succès passés pertinents (filtre mécanique par mots-clés du goal — voir
  // memory/store.ts) injecté dans le prompt du planner, jamais une simple
  // table qui existe sans lecteur. "Ne jamais répéter une approche déjà
  // connue pour avoir échoué" (§59).
  const keywords = goalKeywords(goal);
  const [failureNotes, successNotes] = await Promise.all([recentFailureNotes(keywords), recentSuccessNotes(keywords)]);

  const userMessage = [
    `OBJECTIF DE LA MISSION : ${goal}`,
    attachmentsSummary ? `PIÈCES JOINTES FOURNIES PAR L'OWNER (§"File Intelligence") :\n${attachmentsSummary}` : null,
    failureNotes ? `ÉCHECS CONNUS SUR DES MISSIONS SIMILAIRES (mémoire réelle — NE JAMAIS répéter ces approches à l'identique) :\n${failureNotes}` : null,
    successNotes ? `SUCCÈS OBSERVÉS SUR DES MISSIONS SIMILAIRES (mémoire réelle — combinaisons/stratégies qui ont RÉELLEMENT fonctionné) :\n${successNotes}` : null,
    `WORLD STATE (faits réels avec provenance) :\n${JSON.stringify(worldState.facts, null, 2)}`,
  ]
    .filter((s): s is string => Boolean(s))
    .join("\n\n");
  const called = await callStructuredSpecialist(provider, PLANNING_TASK_SET, system, userMessage, planSchema, 1500);
  return { nodes: called.output.data.nodes, costUsd: called.costUsd ?? null, provider: called.provider, model: called.model };
}

/**
 * §10 "ADD INSTRUCTION DURING MISSION" (06/09/2026), clôture réelle.
 *
 * RÉPLANIFICATION RÉELLE déclenchée par une instruction Owner ajoutée en
 * cours de mission — jamais un redémarrage du plan (le graphe existant,
 * SUCCEEDED comme PENDING, n'est jamais touché ici : seuls des nodes
 * NOUVEAUX sont ajoutés, §"preserves prior work"). `dependsOn` est
 * volontairement TOUJOURS vide pour ces nodes : les rattacher à des clés
 * existantes du graphe risquerait de référencer une clé inconnue au modèle
 * (qui ne voit que l'instruction + le World State, jamais la liste des clés
 * internes du graphe) — un node sans dépendance démarre immédiatement,
 * cohérent avec "l'instruction doit prendre effet maintenant", jamais mis en
 * attente d'un node qui n'a pas de raison de le bloquer.
 */
async function planNodesForInstruction(
  provider: ModelProvider,
  goal: string,
  instruction: string,
  worldState: WorldState,
  enabledRoles: readonly string[],
): Promise<{ nodes: Array<{ key: string; role: string; objective: string; previewPath?: string; pageDescription?: string; dataQuery?: { metricKeyPrefix: string; operation: string } }>; costUsd: number | null }> {
  const system = [
    `Tu es le Supervisor d'OnDeal AI. La mission est déjà EN COURS D'EXÉCUTION ; l'Owner vient d'ajouter une INSTRUCTION SUPPLÉMENTAIRE, en direct, sans interrompre le travail déjà accompli.`,
    `Décompose UNIQUEMENT ce qu'il faut faire EN PLUS pour satisfaire cette nouvelle instruction — jamais une reformulation du plan existant, jamais un node qui referait un travail déjà réalisé (voir les faits déjà présents dans le World State ci-dessous, en particulier tout fait de source OWNER_INSTRUCTION précédent).`,
    `Rôles disponibles (les mêmes que le plan initial, UNIQUEMENT ceux-ci) : ${enabledRoles.join(", ")}.`,
    `Chaque node a "key" (unique, jamais une clé déjà utilisée dans ce plan), "role", "objective". "dependsOn" n'existe PAS pour ces nodes — ils démarrent immédiatement, ne le mentionne pas.`,
    `Si l'instruction ne demande RÉELLEMENT aucun travail supplémentaire (ex. une simple clarification déjà couverte), réponds avec un tableau "nodes" VIDE dans "data" — jamais un node fabriqué pour paraître réactif.`,
    // Même correctif que planInitialGraph ci-dessus : callStructuredSpecialist
    // exige TOUJOURS l'enveloppe complète, jamais {"nodes":[...]} nu.
    `Réponds STRICTEMENT en JSON avec L'ENVELOPPE COMPLÈTE attendue (la même que TOUS les spécialistes d'OnDeal AI) : {"findings":[...],"evidence":[...],"uncertainties":[...],"recommendations":[...],"confidence":0-1,"data":{"nodes":[{"key":"...","role":"...","objective":"...","previewPath":"..."?,"pageDescription":"..."?,"dataQuery":{...}?}]}}. Le tableau "nodes" DOIT être à l'intérieur du champ "data" — JAMAIS à la racine. "findings"/"evidence"/"uncertainties"/"recommendations" peuvent être vides ; "confidence" = ta confiance (0 à 1) que ces nodes supplémentaires couvrent correctement l'instruction.`,
  ].join("\n");
  const userMessage = [
    `OBJECTIF GLOBAL DE LA MISSION : ${goal}`,
    `INSTRUCTION OWNER AJOUTÉE EN COURS DE MISSION : ${instruction}`,
    `WORLD STATE ACTUEL (faits réels avec provenance, inclut le travail déjà accompli) :\n${JSON.stringify(worldState.facts, null, 2)}`,
  ].join("\n\n");
  const called = await callStructuredSpecialist(provider, PLANNING_TASK_SET, system, userMessage, instructionPlanSchema, 1200);
  return { nodes: called.output.data.nodes.map(({ key, role, objective, previewPath, pageDescription, dataQuery }) => ({ key, role, objective, previewPath, pageDescription, dataQuery })), costUsd: called.costUsd ?? null };
}

/**
 * Nodes dont TOUTES les dépendances sont dans un état terminal RÉUSSI
 * (SUCCEEDED) — un node dépendant d'un SKIPPED ou FAILED est lui-même
 * PROPAGÉ en SKIPPED (§11 PRUNE en cascade), jamais laissé PENDING pour
 * toujours (deadlock silencieux).
 */
function partitionRunnable(nodes: GraphNodeRow[]): { runnable: GraphNodeRow[]; toCascadeSkip: Array<{ node: GraphNodeRow; reason: string }> } {
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const runnable: GraphNodeRow[] = [];
  const toCascadeSkip: Array<{ node: GraphNodeRow; reason: string }> = [];
  for (const node of nodes) {
    if (node.status !== "PENDING") continue;
    const deps = node.dependsOn.map((k) => byKey.get(k)).filter((d): d is GraphNodeRow => Boolean(d));
    const unresolvedButBad = deps.find((d) => d.status === "FAILED" || d.status === "SKIPPED");
    if (unresolvedButBad) {
      toCascadeSkip.push({ node, reason: `Dépendance "${unresolvedButBad.key}" en état ${unresolvedButBad.status} — branche abandonnée (§11 PRUNE en cascade).` });
      continue;
    }
    const allSucceeded = deps.every((d) => d.status === "SUCCEEDED");
    if (allSucceeded) runnable.push(node);
  }
  return { runnable, toCascadeSkip };
}

/**
 * §28 : délègue ENTIÈREMENT à une vraie CoderMission Phase 3 — aucune
 * réimplémentation de typecheck/lint/test/build/preview/browser/vision ici.
 *
 * PHASE 5 (§178) : GÉNÉRALISÉ — l'objectif de code vient directement de
 * node.input.objective (fourni par le plan pour CE node précis, jamais
 * supposé être "refonte de /login") ; enrichi, si des dépendances existent,
 * par un résumé de leurs findings/recommendations (générique, marche pour
 * n'importe quel brief en amont — synthesis, researcher, data_analyst...).
 */
async function runCoderImplementationNode(
  node: GraphNodeRow,
  deps: GraphRunnerDeps,
  getNodeOutput: (key: string) => SpecialistOutput | undefined,
): Promise<NodeExecutionResult> {
  const objective = node.input.objective;
  if (!objective) {
    throw new Error(`Node "coder_implementation" ("${node.key}") sans "objective" dans le plan — impossible de dériver un objectif de code sans l'inventer.`);
  }

  const upstreamSummaries: string[] = [];
  for (const depKey of node.dependsOn) {
    const depOutput = getNodeOutput(depKey);
    if (!depOutput) continue;
    upstreamSummaries.push(
      `Node "${depKey}" — trouvailles : ${depOutput.findings.join(" | ") || "(aucune)"} — recommandations : ${depOutput.recommendations.join(" | ") || "(aucune)"}`,
    );
  }

  const goal = [
    `Objectif d'implémentation (SANDBOX UNIQUEMENT — §61 : ne JAMAIS toucher à la production) : ${objective}`,
    upstreamSummaries.length > 0 ? `Contexte fourni par les analyses en amont de cette mission :\n${upstreamSummaries.join("\n")}` : null,
    `Contrainte stricte : rester strictement dans le périmètre de l'objectif ci-dessus — jamais un fichier de données, jamais une route API sensible, jamais schema.prisma, sans lien direct avec cet objectif.`,
  ]
    .filter((s): s is string => Boolean(s))
    .join("\n\n");

  const mission = await createMission({ goal, createdByUserId: deps.createdByUserId });
  const claimed = await claimMissionById(mission.id);
  if (!claimed) throw new Error(`Impossible de réclamer la CoderMission "${mission.id}" juste créée (état inattendu — jamais rejoué silencieusement).`);

  const previewPath = (node.input.previewPath as string | undefined) ?? "/";
  const pageDescription = (node.input.pageDescription as string | undefined) ?? `Page "${previewPath}" d'OnDeal Intelligence, candidate sandbox pour l'objectif : ${objective}`;

  const coderConfig: CoderMissionConfig = {
    sourceRepoRoot: deps.sourceRepoRoot,
    security: deps.coderSecurity,
    previewPort: deps.coderPreviewPort,
    previewPath,
    pageDescriptionForVision: pageDescription,
  };
  const steps = buildCoderMissionSteps(deps.provider, coderConfig);
  const outcome = await runMissionToCompletion(claimed, steps);

  if (outcome.status !== "SUCCEEDED") {
    const reason = outcome.status === "FAILED" ? outcome.reason : `statut ${outcome.status}`;
    throw new Error(`CoderMission "${mission.id}" (implémentation) n'a pas réussi : ${reason}`);
  }

  const full = await getMission(mission.id);
  const succeededSteps = full?.steps.filter((s) => s.status === "SUCCEEDED") ?? [];
  const diffStep = succeededSteps.find((s) => s.name === "diff");
  const verifyStep = succeededSteps.find((s) => s.name === "verify_and_fix");
  const diffOutput = diffStep?.outputJson ? (JSON.parse(diffStep.outputJson) as { diffText: string }) : null;
  const verifyOutput = verifyStep?.outputJson
    ? (JSON.parse(verifyStep.outputJson) as { success: boolean; iterations: Array<{ attempt: number; ok: boolean; reason?: string }>; criticReport: { overallPass: boolean; issues: unknown[] }; editedFiles: string[] })
    : null;
  const artifacts = await prisma.coderMissionArtifact.findMany({ where: { missionId: mission.id } });
  const totalCostUsd = succeededSteps.reduce((sum, s) => sum + (s.costUsd ?? 0), 0);
  const iterationCount = verifyOutput?.iterations.length ?? 1;

  const output: SpecialistOutput = {
    findings: [
      `CoderMission "${mission.id}" réussie — ${iterationCount} tentative(s) de vérification (typecheck/lint/test/build/preview/browser/vision) avant succès.`,
      verifyOutput ? `Fichiers modifiés : ${verifyOutput.editedFiles.join(", ")}.` : "Aucune sortie verify_and_fix retrouvée (inattendu — mission marquée SUCCEEDED).",
      verifyOutput?.criticReport ? `Revue visuelle finale du Coder Agent (Phase 3) : overallPass=${verifyOutput.criticReport.overallPass}, ${verifyOutput.criticReport.issues.length} problème(s) résiduel(s) non bloquant(s).` : "Pas de rapport visuel final disponible.",
    ],
    evidence: [
      diffOutput ? `Diff réel (git) capturé, ${diffOutput.diffText.length} caractères — artefact DIFF persisté.` : "Diff non retrouvé.",
      `${artifacts.length} artefact(s) réel(s) persisté(s) (captures d'écran/diff) pour cette CoderMission.`,
    ],
    uncertainties: [
      "Revue visuelle réalisée par le modèle Vision du Router uniquement à ce stade du graphe — pas encore de revue humaine indépendante (viendra du node adversarial_critic/independent_judge en aval si la mission en inclut).",
    ],
    recommendations: iterationCount > 1 ? ["Plusieurs itérations de correction ont été nécessaires — signal à examiner par le Critic/Judge en aval avant tout READY_FOR_RELEASE."] : [],
    confidence: iterationCount === 1 ? 0.85 : Math.max(0.4, 0.85 - 0.15 * (iterationCount - 1)),
    data: {
      coderMissionId: mission.id,
      editedFiles: verifyOutput?.editedFiles ?? [],
      diffText: diffOutput?.diffText ?? null,
      criticReport: verifyOutput?.criticReport ?? null,
      iterations: verifyOutput?.iterations ?? [],
    },
  };

  return {
    output,
    provider: verifyStep?.provider ?? undefined,
    model: verifyStep?.model ?? undefined,
    costUsd: totalCostUsd > 0 ? totalCostUsd : undefined,
    artifacts: artifacts.map((a) => ({ kind: a.kind, storageRef: a.storageRef, meta: a.metaJson ? (JSON.parse(a.metaJson) as Record<string, unknown>) : undefined })),
  };
}

/**
 * Boucle principale — réclame et exécute les nodes RUNNABLE jusqu'à ce que
 * le graphe soit dans un état terminal. Parallélisme RÉEL pour les nodes
 * indépendants (§56) via Promise.all sur le lot runnable de CHAQUE
 * itération.
 *
 * PHASE 5 : RÉSUMABLE (§"Real-Time Controls") — si `missionId` a déjà des
 * nodes (appel précédent mis en PAUSED par la borne murale), le plan
 * n'est PAS refait : on reprend directement la boucle sur l'état existant.
 * Ajoute aussi le plafond de budget dur (STOP/PAUSE, jamais un dépassement
 * silencieux) et la borne murale (PAUSED, résumable).
 */
async function runStorefrontMissionInner(missionId: string, deps: GraphRunnerDeps): Promise<GraphRunnerOutcome> {
  const mission = await getStorefrontMission(missionId);
  if (!mission) throw new Error(`StorefrontMission "${missionId}" introuvable.`);

  const startedAtMs = Date.now();
  let totalCostUsd = mission.totalCostUsd ?? 0;

  const isResume = mission.nodes.length > 0;
  let worldState: WorldState;
  if (isResume && mission.worldStateJson) {
    worldState = JSON.parse(mission.worldStateJson) as WorldState;
  } else {
    worldState = await buildWorldState(deps.sourceRepoRoot);
    await setMissionWorldState(missionId, JSON.stringify(worldState));
  }

  if (!isResume) {
    const attachments = await prisma.aiLabAttachment.findMany({ where: { missionId } });
    const attachmentsSummary =
      attachments.length > 0
        ? attachments
            .map((a) => `- ${a.filename} (${a.mimeType}, ${a.parseStatus}) : ${a.extractedText ? a.extractedText.slice(0, 1500) : "(pas de texte extrait — voir parseError)"}`)
            .join("\n")
        : null;

    const disabledRolesAtPlan = await listDisabledRoles();
    const enabledRolesAtPlan = AVAILABLE_ROLES.filter((r) => !disabledRolesAtPlan.has(r));
    const plan = await planInitialGraph(deps.provider, mission.goal, worldState, attachmentsSummary, enabledRolesAtPlan);
    totalCostUsd += plan.costUsd ?? 0;
    await addNodes(
      missionId,
      plan.nodes.map((n) => ({
        key: n.key,
        role: n.role,
        dependsOn: n.dependsOn,
        input: { objective: n.objective, previewPath: n.previewPath, pageDescription: n.pageDescription, dataQuery: n.dataQuery },
      })),
    );
  }
  await setMissionRunning(missionId);

  const catalogue = buildCatalogue(deps.provider);
  const outputsByKey = new Map<string, SpecialistOutput>();
  // PHASE 5 (reprise, §"Real-Time Controls") : ré-hydrate le cache des
  // sorties déjà produites lors d'un appel précédent — sinon un node aval
  // déjà réclamable au moment de la reprise ne pourrait pas lire les
  // sorties de ses dépendances déjà SUCCEEDED.
  for (const n of mission.nodes) {
    if (n.status === "SUCCEEDED" && n.outputJson) {
      outputsByKey.set(n.key, JSON.parse(n.outputJson) as SpecialistOutput);
    }
  }
  const getNodeOutput = (key: string): SpecialistOutput | undefined => outputsByKey.get(key);

  // NO BLIND LOOP : bornée par le nombre de nodes jamais réclamable deux fois
  // (chaque itération réclame puis termine un node PENDING → progrès garanti
  // ou sortie explicite) — pas de compteur d'itérations arbitraire séparé,
  // la garde réelle est "aucun node PENDING/RUNNING restant".
  for (;;) {
    if (await isCancelRequested(missionId)) {
      await markMissionCancelled(missionId);
      await appendAuditLog({ missionId, action: "mission_cancel", reason: "Annulation coopérative demandée par l'Owner (cancelRequested).", resultStatus: "SUCCESS" });
      return { status: "CANCELLED", missionId };
    }

    // §10 "ADD INSTRUCTION DURING MISSION" (06/09/2026), clôture réelle —
    // vérifié à CHAQUE itération, même cadence que le Kill Switch
    // coopératif ci-dessus. `consumePendingInstruction` est atomique
    // (lue+effacée+journalisée dans instructionsJson en une transaction) :
    // jamais retraitée deux fois même en cas de reprise après PAUSED.
    const instruction = await consumePendingInstruction(missionId);
    if (instruction) {
      worldState.facts.push({
        key: `owner_instruction_${Date.now()}`,
        value: instruction,
        kind: "FACT",
        source: "OWNER_INSTRUCTION",
        note: "Instruction ajoutée par l'Owner en cours de mission — jamais une inférence du modèle.",
      });
      await setMissionWorldState(missionId, JSON.stringify(worldState));
      await appendAuditLog({ missionId, action: "instruction_added", reason: `Instruction Owner reçue en cours de mission : "${instruction}"`, resultStatus: "SUCCESS" });

      try {
        const disabledRolesAtReplan = await listDisabledRoles();
        const enabledRolesAtReplan = AVAILABLE_ROLES.filter((r) => !disabledRolesAtReplan.has(r));
        const replan = await planNodesForInstruction(deps.provider, mission.goal, instruction, worldState, enabledRolesAtReplan);
        totalCostUsd += replan.costUsd ?? 0;
        if (replan.nodes.length > 0) {
          await addNodes(missionId, replan.nodes.map((n) => ({ key: n.key, role: n.role, dependsOn: [], input: { objective: n.objective, previewPath: n.previewPath, pageDescription: n.pageDescription, dataQuery: n.dataQuery } })));
          await appendAuditLog({ missionId, action: "instruction_replanned", reason: `Réplanification réelle : ${replan.nodes.length} node(s) ajouté(s) (${replan.nodes.map((n) => n.key).join(", ")}) — travail déjà accompli PRÉSERVÉ, jamais redémarré.`, resultStatus: "SUCCESS" });
        } else {
          await appendAuditLog({ missionId, action: "instruction_replanned", reason: "Réplanification réelle : aucun node supplémentaire jugé nécessaire pour cette instruction.", resultStatus: "SUCCESS" });
        }
      } catch (err) {
        // Une réplanification ratée ne doit JAMAIS faire échouer toute la
        // mission (l'instruction est déjà journalisée dans le World State et
        // instructionsJson, jamais perdue) — seule cette tentative de
        // traduction en nodes est en échec, journalisé honnêtement.
        const message = err instanceof Error ? err.message : String(err);
        await appendAuditLog({ missionId, action: "instruction_replanned", reason: `Échec de la réplanification pour cette instruction : ${message} (l'instruction reste visible dans le World State/instructionsJson, jamais perdue).`, resultStatus: "FAILURE" });
      }
    }

    // §"Owner Sovereignty" (Kill Switch, §3/§17) : gate RÉEL vérifié à
    // CHAQUE itération — un Kill Switch engagé pendant l'exécution arrête
    // la mission dès l'itération suivante, jamais seulement au démarrage.
    const cognitionGate = await evaluatePolicy({
      autonomyLevel: mission.autonomyLevel as PolicyContext["autonomyLevel"],
      environment: mission.environment as PolicyContext["environment"],
      riskClass: "COGNITION",
      currentCostUsd: totalCostUsd,
      hardBudgetUsd: mission.hardBudgetUsd ?? deps.hardBudgetUsd ?? null,
    });
    await appendAuditLog({ missionId, action: "policy_decision", decision: cognitionGate.decision, riskClass: "COGNITION", reason: cognitionGate.reason, costUsd: totalCostUsd, resultStatus: cognitionGate.decision === "ALLOW_AUTO" ? "SUCCESS" : "DENIED" });
    if (cognitionGate.decision !== "ALLOW_AUTO") {
      await markMissionPaused(missionId, cognitionGate.reason);
      return { status: "PAUSED", missionId, reason: cognitionGate.reason };
    }

    if (deps.maxWallClockMs && Date.now() - startedAtMs > deps.maxWallClockMs) {
      const reason = `Borne murale atteinte (${deps.maxWallClockMs}ms) — mission mise en PAUSE, résumable par un nouvel appel avec le même missionId (jamais une exécution tronquée silencieusement).`;
      await markMissionPaused(missionId, reason);
      return { status: "PAUSED", missionId, reason };
    }

    if (deps.hardBudgetUsd != null && totalCostUsd > deps.hardBudgetUsd) {
      const reason = `Budget dur dépassé : ${totalCostUsd.toFixed(4)} USD > ${deps.hardBudgetUsd} USD — mission mise en PAUSE (§"Hard Budget" : jamais un dépassement silencieux).`;
      await markMissionPaused(missionId, reason);
      return { status: "PAUSED", missionId, reason };
    }

    const disabledRolesNow = await listDisabledRoles(); // §15 "Owner Agent Control" — lu à CHAQUE itération, effet runtime immédiat si l'Owner désactive un rôle pendant l'exécution
    const nodes = await listNodes(missionId);
    const stillActive = nodes.filter((n) => n.status === "PENDING" || n.status === "RUNNING");
    if (stillActive.length === 0) break;

    const { runnable, toCascadeSkip } = partitionRunnable(nodes);
    for (const { node, reason } of toCascadeSkip) {
      await skipNode({ nodeId: node.id, reason });
    }
    if (runnable.length === 0) {
      if (toCascadeSkip.length > 0) continue; // les skips en cascade peuvent débloquer d'autres nodes au prochain tour
      // Plus rien de runnable, mais des nodes PENDING/RUNNING existent encore
      // sans dépendance en échec identifiée : état incohérent (jamais un
      // deadlock silencieux) — échec explicite avec diagnostic complet.
      await markMissionFailed(missionId, `Deadlock détecté : ${stillActive.length} node(s) actif(s) mais aucun runnable et aucune dépendance en échec identifiée. Nodes : ${stillActive.map((n) => `${n.key}(deps=${n.dependsOn.join(",")})`).join("; ")}.`);
      return { status: "FAILED", missionId, reason: "Deadlock du graphe — voir lastError." };
    }

    const results = await Promise.all(
      runnable.map(async (node) => {
        const claimed = await claimNode(node.id);
        if (!claimed) return null; // déjà réclamé par une autre itération/exécution concurrente — jamais un double-traitement
        const heartbeatTimer = setInterval(() => void heartbeatNode(node.id).catch(() => {}), 60_000);
        try {
          // §15 "Owner Agent Control" (06/09/2026), défense en profondeur :
          // un rôle désactivé par l'Owner APRÈS la création du plan (donc
          // encore référencé par un node PENDING existant) ne s'exécute
          // jamais — le node échoue avec une raison explicite plutôt qu'un
          // skip muet, cohérent avec "jamais un contournement silencieux du
          // contrôle Owner".
          if (disabledRolesNow.has(node.role)) {
            throw new Error(`Rôle "${node.role}" désactivé par l'Owner (AI LAB → AGENTS) — ce node ne peut pas s'exécuter tant qu'il n'est pas réactivé.`);
          }
          const contract: SpecialistContract = {
            role: node.role,
            objective: node.input.objective ?? `Exécuter le rôle "${node.role}" pour la mission "${mission.goal}" (aucun objectif spécifique fourni par le plan — jamais inventé, l'objectif global de la mission sert de repli explicite).`,
            context: { dependsOnKeys: node.dependsOn, dataQuery: node.input.dataQuery },
            allowedTools: [],
            budget: { maxCostUsd: deps.coderSecurity.maxCostUsd },
            outputSchemaName: node.role,
          };

          let execResult: NodeExecutionResult & { additionalNodes?: GraphNodeSpec[] };
          if (node.role === "coder_implementation") {
            // §8 "CONTROLLED EFFECTORS" : le seul rôle de ce catalogue qui
            // écrit réellement quelque chose (un workspace sandbox Coder
            // Agent, jamais le dépôt réel) — gate de policy explicite avant
            // exécution, jamais un ALLOW implicite parce que "c'est déjà du
            // sandbox de toute façon" côté code appelant.
            const effectGate = await evaluatePolicy({
              autonomyLevel: mission.autonomyLevel as PolicyContext["autonomyLevel"],
              environment: mission.environment as PolicyContext["environment"],
              riskClass: "SANDBOX_EFFECT",
              currentCostUsd: totalCostUsd,
              hardBudgetUsd: mission.hardBudgetUsd ?? deps.hardBudgetUsd ?? null,
            });
            await appendAuditLog({ missionId, nodeKey: node.key, agentRole: node.role, action: "policy_decision", decision: effectGate.decision, riskClass: "SANDBOX_EFFECT", reason: effectGate.reason, resultStatus: effectGate.decision === "ALLOW_AUTO" ? "SUCCESS" : "DENIED" });
            if (effectGate.decision !== "ALLOW_AUTO") {
              throw new Error(`Policy Engine a refusé le node "coder_implementation" ("${node.key}") : ${effectGate.reason}`);
            }
            execResult = await runCoderImplementationNode(node, deps, getNodeOutput);
          } else {
            const executor = dispatchSpecialist(node.role, catalogue);
            execResult = await executor({ contract, getNodeOutput, worldState, workspaceRoot: deps.sourceRepoRoot });
          }

          // §32 "Provider Handoff UI toujours visible, jamais un fallback
          // muet" : si le FailoverProvider a dû essayer d'autres candidats
          // avant que celui-ci ne réponde, c'est visible ICI, dans le MÊME
          // journal d'audit que l'utilisateur consulte déjà (onglet
          // Missions → Décisions & Audit) — aucune nouvelle table, aucun
          // nouvel écran requis pour que ce soit honnêtement visible.
          const failoverNote =
            execResult.failoverAttempts && execResult.failoverAttempts.length > 0
              ? ` [PROVIDER CONTINUITY] ${execResult.failoverAttempts.length} candidat(s) essayé(s) avant succès : ${execResult.failoverAttempts.map((a) => `${a.provider}/${a.model}→${a.failureCategory}`).join(", ")}.`
              : "";
          await appendAuditLog({
            missionId,
            nodeKey: node.key,
            agentRole: node.role,
            provider: execResult.provider,
            model: execResult.model,
            action: "node_execute",
            reason: `Node "${node.key}" (rôle "${node.role}") exécuté avec succès.${failoverNote}`,
            costUsd: execResult.costUsd,
            resultStatus: "SUCCESS",
          });
          await succeedNode({
            nodeId: node.id,
            missionId,
            output: execResult.output,
            provider: execResult.provider,
            model: execResult.model,
            costUsd: execResult.costUsd,
            tokensIn: execResult.tokensIn,
            tokensOut: execResult.tokensOut,
            artifacts: execResult.artifacts,
          });
          if (execResult.additionalNodes && execResult.additionalNodes.length > 0) {
            // §5 réplanification réelle : un spécialiste peut faire évoluer le
            // graphe en cours de mission — jamais un plan figé au démarrage.
            await addNodes(
              missionId,
              execResult.additionalNodes.map((n) => ({ key: n.key, role: n.role, dependsOn: n.dependsOn, input: { objective: n.contract.objective } })),
            );
          }
          outputsByKey.set(node.key, execResult.output);
          return { ok: true as const, costUsd: execResult.costUsd ?? 0 };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          await failNode({ nodeId: node.id, error: message });
          await appendAuditLog({ missionId, nodeKey: node.key, agentRole: node.role, action: "node_execute", reason: message, resultStatus: "FAILURE" });
          // §59 "failure-memory" (06/09/2026) : écrit RÉELLEMENT un enregistrement
          // — jamais seulement journalisé dans l'audit (l'audit est un journal
          // d'événements, la mémoire est ce qu'un FUTUR planning relit).
          await writeMemory({
            scope: "FAILURE",
            content: `Rôle "${node.role}" a échoué sur l'objectif "${node.input.objective ?? mission.goal}" : ${message}`,
            sourceKind: "mission_result",
            missionId,
            meta: { role: node.role },
          }).catch(() => {}); // l'écriture mémoire ne doit jamais faire échouer la mission elle-même (best-effort, jamais un throw en cascade)
          return { ok: false as const, key: node.key, error: message };
        } finally {
          clearInterval(heartbeatTimer);
        }
      }),
    );

    for (const r of results) {
      if (r && r.ok) totalCostUsd += r.costUsd;
    }
  }

  const finalNodes = await listNodes(missionId);
  const anyFailed = finalNodes.some((n) => n.status === "FAILED");
  const anySucceeded = finalNodes.some((n) => n.status === "SUCCEEDED");

  if (anyFailed || !anySucceeded) {
    const failedKeys = finalNodes.filter((n) => n.status === "FAILED").map((n) => n.key);
    await markMissionFailed(missionId, `Mission terminée avec ${failedKeys.length} node(s) en échec (${failedKeys.join(", ") || "aucun"})${!anySucceeded ? " et aucun node réussi" : ""}.`);
    return { status: "FAILED", missionId, reason: "Voir lastError." };
  }

  // PHASE 5 (§178, goal-agnostic) : le résultat final n'exige plus TOUJOURS
  // un node "independent_judge" (Phase 4 l'imposait — câblé sur la mission
  // /login qui en avait un). S'il y en a un et qu'il a réussi, son verdict
  // reste le résultat structurant (comportement Phase 4 inchangé). Sinon,
  // le résultat est la sortie des nodes "terminaux" du graphe (aucun autre
  // node ne dépend d'eux) — générique, fonctionne pour n'importe quelle
  // forme de mission.
  const successRolesUsed = [...new Set(finalNodes.filter((n) => n.status === "SUCCEEDED").map((n) => n.role))];
  const successMemoryContent = `Mission "${mission.goal}" réussie avec les rôles [${successRolesUsed.join(", ")}], coût total ${totalCostUsd.toFixed(4)}$ USD.`;

  const judgeNode = finalNodes.find((n) => n.role === "independent_judge" && n.status === "SUCCEEDED");
  if (judgeNode) {
    await markMissionSucceeded(missionId, { judgeVerdict: judgeNode.output }, totalCostUsd);
    await writeMemory({ scope: "OUTCOME", content: successMemoryContent, sourceKind: "mission_result", missionId, meta: { roles: successRolesUsed, totalCostUsd } }).catch(() => {});
    return { status: "SUCCEEDED", missionId, totalCostUsd };
  }

  const dependedOnKeys = new Set(finalNodes.flatMap((n) => n.dependsOn));
  const terminalNodes = finalNodes.filter((n) => n.status === "SUCCEEDED" && !dependedOnKeys.has(n.key));
  const finalOutputs = Object.fromEntries(terminalNodes.map((n) => [n.key, n.output]));
  await markMissionSucceeded(missionId, { finalOutputs }, totalCostUsd);
  await writeMemory({ scope: "OUTCOME", content: successMemoryContent, sourceKind: "mission_result", missionId, meta: { roles: successRolesUsed, totalCostUsd } }).catch(() => {});
  return { status: "SUCCEEDED", missionId, totalCostUsd };
}

/**
 * CORRECTIF DE PRODUCTION (06/09/2026, mission réelle
 * "cmtq415440000l204rqiey6j8" — premier vrai test Owner) : wrapper de
 * sécurité EXTERNE, obligatoire, autour de runStorefrontMissionInner.
 *
 * Root cause du bug original (voir aussi le correctif de prompt sur
 * planInitialGraph/planNodesForInstruction ci-dessus) : une exception levée
 * N'IMPORTE OÙ avant/entre les étapes de préparation (World State, lecture
 * des attachments, appel LLM du planner, persistance des nodes,
 * setMissionRunning...) — donc AVANT que la boucle principale (qui, elle,
 * intercepte déjà chaque échec de node individuellement) ne démarre — se
 * propageait NON INTERCEPTÉE jusqu'à la route API
 * (src/app/api/ai-lab/missions/[id]/run/route.ts n'avait AUCUN try/catch
 * autour de cet appel). Résultat observé en production : un HTTP 500 brut
 * ET une mission bloquée pour toujours dans son statut PRÉCÉDENT
 * (PLANNING), SANS AUCUN node — jamais un état terminal honnête, exactement
 * le symptôme rapporté par l'Owner.
 *
 * Ce wrapper garantit qu'AUCUNE exception, actuelle ou future, ne peut plus
 * jamais laisser une mission dans cet état zombie : toute erreur qui
 * s'échappe malgré tout de runStorefrontMissionInner fait basculer la
 * mission en FAILED, avec la cause RÉELLE persistée dans lastError — jamais
 * un statut PLANNING/RUNNING fantôme. C'est une défense en profondeur
 * DÉLIBÉRÉMENT redondante avec le correctif de prompt : celui-ci corrige LA
 * cause identifiée, celui-là garantit qu'AUCUNE cause, même non encore
 * identifiée, ne peut reproduire ce symptôme.
 *
 * Ne journalise PAS elle-même de "mission_run_finished" — l'appelant
 * (route.ts) le fait déjà systématiquement à partir de l'outcome retourné
 * ici (qu'il soit SUCCEEDED, FAILED, CANCELLED ou PAUSED) : dupliquer cet
 * appel ici produirait deux entrées d'audit pour une seule exécution.
 */
export async function runStorefrontMission(missionId: string, deps: GraphRunnerDeps): Promise<GraphRunnerOutcome> {
  try {
    return await runStorefrontMissionInner(missionId, deps);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      await markMissionFailed(missionId, `Erreur fatale non interceptée pendant la préparation/exécution de la mission : ${message}`);
    } catch (persistErr) {
      // Même si la persistance de l'état FAILED échoue elle-même (DB
      // indisponible, etc.), on ne masque JAMAIS l'erreur d'origine — elle
      // reste celle renvoyée à l'appelant ci-dessous, jamais remplacée par
      // cette erreur secondaire de persistance.
      console.error(`[graphRunner] Échec de la persistance de l'état FAILED pour la mission "${missionId}" après une erreur fatale non interceptée :`, persistErr);
    }
    return { status: "FAILED", missionId, reason: message };
  }
}
