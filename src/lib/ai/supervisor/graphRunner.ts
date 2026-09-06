import { prisma } from "@/lib/db";
import type { ModelProvider } from "@/lib/ai/providers/provider";
import { createMission, claimMissionById, getMission } from "@/lib/ai/coder/missionStore";
import { runMissionToCompletion } from "@/lib/ai/coder/missionRunner";
import { buildCoderMissionSteps, type CoderMissionConfig } from "@/lib/ai/coder/steps";
import type { MissionSecurityBudget } from "@/lib/ai/coder/types";
import {
  addNodes,
  claimNode,
  failNode,
  getStorefrontMission,
  heartbeatNode,
  isCancelRequested,
  listNodes,
  markMissionCancelled,
  markMissionFailed,
  markMissionSucceeded,
  setMissionRunning,
  setMissionWorldState,
  skipNode,
  succeedNode,
  type GraphNodeRow,
} from "@/lib/ai/supervisor/graphStore";
import { buildWorldState } from "@/lib/ai/supervisor/worldState";
import { buildCatalogue, type SpecialistCatalogue } from "@/lib/ai/supervisor/catalogue";
import { PLANNING_TASK_SET, callStructuredSpecialist, planSchema } from "@/lib/ai/supervisor/specialists";
import type { GraphNodeSpec, NodeExecutionResult, SpecialistContract, SpecialistOutput, WorldState } from "@/lib/ai/supervisor/types";

/**
 * ONDEAL AI CORE — PHASE 4 : Supervisor — graphe dynamique + boucle
 * d'exécution réelle (06/09/2026), §2/§3/§5/§9/§11/§28/§56.
 *
 * Ce fichier est le SEUL endroit qui décide QUAND un node tourne (aucune
 * logique d'ordonnancement dans catalogue.ts — chaque spécialiste ignore
 * complètement le graphe, cohérent avec §7 "contrat" : un spécialiste ne
 * connaît que SON contrat + les sorties de SES dépendances déclarées).
 *
 * §28 (RÉUTILISATION LITTÉRALE du Coder Agent PHASE 3, jamais une
 * réimplémentation) : le node "coder_implementation" ne fait RIEN de
 * nouveau — il crée une VRAIE CoderMission (missionStore.createMission),
 * construit ses steps RÉELS (steps.ts::buildCoderMissionSteps, donc
 * inspect→plan→edit→diff→verify_and_fix avec la boucle FIX bornée +
 * typecheck/lint/test/build + preview + browser + vision, TOUT hérité
 * gratuitement) et l'exécute avec missionRunner.ts::runMissionToCompletion
 * SANS AUCUNE MODIFICATION de ces trois fichiers. Le graphe Storefront
 * n'est qu'un ORCHESTRATEUR AU-DESSUS de la mission Coder Agent existante,
 * jamais un chemin d'écriture de code parallèle.
 */

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
    default:
      // §85 : un rôle de plan inconnu n'est PAS un blocker "légal/irréversible" —
      // c'est un bug de plan. Jamais silencieusement ignoré (throw explicite,
      // jamais un skip muet) : la mission échoue avec une raison exacte.
      throw new Error(`Rôle de spécialiste inconnu dans le plan : "${role}" (catalogue.ts n'a pas d'exécuteur pour ce rôle).`);
  }
}

export interface GraphRunnerDeps {
  provider: ModelProvider;
  sourceRepoRoot: string;
  createdByUserId: string;
  /** §6 SANDBOX REQUIREMENTS — réutilisé tel quel par buildCoderMissionSteps (steps.ts), jamais un budget par défaut implicite. */
  coderSecurity: MissionSecurityBudget;
  coderPreviewPort: number;
}

export type GraphRunnerOutcome =
  | { status: "SUCCEEDED"; missionId: string; totalCostUsd: number }
  | { status: "FAILED"; missionId: string; reason: string }
  | { status: "CANCELLED"; missionId: string };

/**
 * §5 : le plan initial est un VRAI appel spécialiste (PLANNING_TASK_SET,
 * planSchema), jamais un tableau de nodes codé en dur ici — la
 * décomposition est produite par le modèle à partir du World State réel.
 */
async function planInitialGraph(
  provider: ModelProvider,
  goal: string,
  worldState: WorldState,
): Promise<{ nodes: Array<{ key: string; role: string; dependsOn: string[]; objective: string }>; costUsd: number | null; provider: string; model: string }> {
  const system = `Tu es le Supervisor d'OnDeal AI (PHASE 4, §2/§3/§5). Décompose l'objectif de très haut niveau reçu en un GRAPHE de nodes (jamais une liste linéaire figée) — chaque node a une clé unique, un rôle (un des suivants UNIQUEMENT : "brand_strategist", "ux_architect", "cro_strategist", "accessibility_reviewer", "performance_reviewer", "creative_director", "synthesis", "coder_implementation", "adversarial_critic", "independent_judge"), un tableau "dependsOn" (clés d'autres nodes de CE plan), et un objectif précis. Les 5 rôles d'analyse (brand/ux/cro/accessibility/performance) doivent être INDÉPENDANTS (dependsOn vide, §56 : parallélisme) ; "creative_director" doit dépendre des 5 analyses ; "synthesis" doit dépendre de "creative_director" ; "coder_implementation" doit dépendre de "synthesis" ; "adversarial_critic" doit dépendre de "coder_implementation" ; "independent_judge" doit dépendre de "adversarial_critic". Réponds STRICTEMENT en JSON : {"nodes":[{"key":"...","role":"...","dependsOn":[...],"objective":"..."}]}.`;
  const userMessage = `OBJECTIF DE LA MISSION : ${goal}\n\nWORLD STATE (faits réels avec provenance) :\n${JSON.stringify(worldState.facts, null, 2)}`;
  const called = await callStructuredSpecialist(provider, PLANNING_TASK_SET, system, userMessage, planSchema, 1500);
  return { nodes: called.output.data.nodes, costUsd: called.costUsd ?? null, provider: called.provider, model: called.model };
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

/** §28 : délègue ENTIÈREMENT à une vraie CoderMission Phase 3 — aucune réimplémentation de typecheck/lint/test/build/preview/browser/vision ici. */
async function runCoderImplementationNode(
  node: GraphNodeRow,
  deps: GraphRunnerDeps,
  getNodeOutput: (key: string) => SpecialistOutput | undefined,
): Promise<NodeExecutionResult> {
  const synthesisOutput = getNodeOutput("synthesis");
  if (!synthesisOutput) {
    throw new Error(`Node "coder_implementation" exécuté sans sortie "synthesis" disponible — dépendance manquante (jamais un objectif inventé).`);
  }
  const finalBrief = (synthesisOutput.data as { finalBrief?: Record<string, string> }).finalBrief;
  if (!finalBrief) {
    throw new Error(`La sortie "synthesis" ne contient pas de "finalBrief" — impossible de dériver un objectif de code réel sans l'inventer.`);
  }
  const goal = [
    `Refonte candidate de /login (sandbox uniquement — §61 : ne JAMAIS toucher à la production) selon le brief validé par la Synthèse :`,
    `Stratégie : ${finalBrief.strategy}`,
    `Récit : ${finalBrief.story}`,
    `Hiérarchie : ${finalBrief.hierarchy}`,
    `Philosophie visuelle : ${finalBrief.visualPhilosophy}`,
    `Raisonnement commercial : ${finalBrief.commerceReasoning}`,
    `Contrainte stricte : ne modifier QUE des fichiers sous src/app/login/ et des composants directement liés — jamais un fichier de données, jamais une route API, jamais schema.prisma.`,
  ].join("\n");

  const mission = await createMission({ goal, createdByUserId: deps.createdByUserId });
  const claimed = await claimMissionById(mission.id);
  if (!claimed) throw new Error(`Impossible de réclamer la CoderMission "${mission.id}" juste créée (état inattendu — jamais rejoué silencieusement).`);

  const coderConfig: CoderMissionConfig = {
    sourceRepoRoot: deps.sourceRepoRoot,
    security: deps.coderSecurity,
    previewPort: deps.coderPreviewPort,
    previewPath: "/login",
    pageDescriptionForVision: "Page /login d'OnDeal Intelligence — sert de page publique de facto (marketing + formulaire de connexion), candidate de refonte premium.",
  };
  const steps = buildCoderMissionSteps(deps.provider, coderConfig);
  const outcome = await runMissionToCompletion(claimed, steps);

  if (outcome.status !== "SUCCEEDED") {
    const reason = outcome.status === "FAILED" ? outcome.reason : `statut ${outcome.status}`;
    throw new Error(`CoderMission "${mission.id}" (implémentation de la candidate) n'a pas réussi : ${reason}`);
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
      "Revue visuelle réalisée par le modèle Vision du Router (Phase 3) uniquement à ce stade du graphe — pas encore de revue humaine indépendante (viendra du node adversarial_critic/independent_judge en aval, qui reçoivent cette sortie).",
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
 * le graphe soit dans un état terminal (plus aucun PENDING ni RUNNING).
 * Parallélisme RÉEL pour les nodes indépendants (§56 : "analyses
 * indépendantes tournent SIMULTANÉMENT") via Promise.all sur le lot
 * runnable de CHAQUE itération — jamais un parallélisme entre nodes qui se
 * dépendent (impossible par construction : un node dépendant n'est
 * "runnable" qu'une fois ses dépendances SUCCEEDED, voir partitionRunnable).
 */
export async function runStorefrontMission(missionId: string, deps: GraphRunnerDeps): Promise<GraphRunnerOutcome> {
  const mission = await getStorefrontMission(missionId);
  if (!mission) throw new Error(`StorefrontMission "${missionId}" introuvable.`);

  const worldState = await buildWorldState(deps.sourceRepoRoot);
  await setMissionWorldState(missionId, JSON.stringify(worldState));

  let totalCostUsd = 0;

  const plan = await planInitialGraph(deps.provider, mission.goal, worldState);
  totalCostUsd += plan.costUsd ?? 0;
  await addNodes(
    missionId,
    plan.nodes.map((n) => ({ key: n.key, role: n.role, dependsOn: n.dependsOn, input: { objective: n.objective } })),
  );
  await setMissionRunning(missionId);

  const catalogue = buildCatalogue(deps.provider);
  const outputsByKey = new Map<string, SpecialistOutput>();
  const getNodeOutput = (key: string): SpecialistOutput | undefined => outputsByKey.get(key);

  // NO BLIND LOOP : bornée par le nombre de nodes jamais réclamable deux fois
  // (chaque itération réclame puis termine un node PENDING → progrès garanti
  // ou sortie explicite) — pas de compteur d'itérations arbitraire séparé,
  // la garde réelle est "aucun node PENDING/RUNNING restant".
  for (;;) {
    if (await isCancelRequested(missionId)) {
      await markMissionCancelled(missionId);
      return { status: "CANCELLED", missionId };
    }

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
          const contract: SpecialistContract = {
            role: node.role,
            objective: node.input.objective ?? `Exécuter le rôle "${node.role}" pour la mission "${mission.goal}" (aucun objectif spécifique fourni par le plan — jamais inventé, l'objectif global de la mission sert de repli explicite).`,
            context: { dependsOnKeys: node.dependsOn },
            allowedTools: [],
            budget: { maxCostUsd: deps.coderSecurity.maxCostUsd },
            outputSchemaName: node.role,
          };

          let execResult: NodeExecutionResult & { additionalNodes?: GraphNodeSpec[] };
          if (node.role === "coder_implementation") {
            execResult = await runCoderImplementationNode(node, deps, getNodeOutput);
          } else {
            const executor = dispatchSpecialist(node.role, catalogue);
            execResult = await executor({ contract, getNodeOutput, worldState, workspaceRoot: deps.sourceRepoRoot });
          }

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
  const judgeNode = finalNodes.find((n) => n.role === "independent_judge" && n.status === "SUCCEEDED");
  const anyFailed = finalNodes.some((n) => n.status === "FAILED");

  if (!judgeNode || anyFailed) {
    const failedKeys = finalNodes.filter((n) => n.status === "FAILED").map((n) => n.key);
    await markMissionFailed(missionId, `Mission terminée sans verdict du Juge indépendant exploitable. Node(s) en échec : ${failedKeys.join(", ") || "aucun (juge jamais atteint)"}.`);
    return { status: "FAILED", missionId, reason: "Pas de verdict du Juge indépendant — voir lastError." };
  }

  await markMissionSucceeded(missionId, { judgeVerdict: judgeNode.output }, totalCostUsd);
  return { status: "SUCCEEDED", missionId, totalCostUsd };
}
