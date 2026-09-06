import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { ModelProvider } from "@/lib/ai/providers/provider";
import { chooseModel } from "@/lib/ai/models/router";
import { estimateCostUsd } from "@/lib/ai/models/cost";
import { createMissionWorkspace } from "@/lib/ai/coder/workspace";
import { editFile, getDiff, readFile, runBuild, runLint, runTests, runTypecheck, searchCode } from "@/lib/ai/coder/operations";
import { closeBrowser, getConsoleMessages, getFailedRequests, getVisibleText, openBrowser, screenshot } from "@/lib/ai/coder/browser";
import { reviewScreenshot } from "@/lib/ai/coder/vision";
import { startPreviewServer, stopPreviewServer } from "@/lib/ai/coder/preview";
import type { MissionSecurityBudget, MissionStepDefinition, VisualCriticReport } from "@/lib/ai/coder/types";

/**
 * ONDEAL AI CORE — PHASE 3 : plan de mission SYSTEM CODER (06/09/2026).
 *
 * Implémente la boucle demandée (§7/§11 de la commande) en 5 STEPS
 * Job Engine (chacun retryable/reprenable indépendamment par
 * missionRunner.ts) :
 *   1. inspect          — crée le workspace isolé, résume le dépôt.
 *   2. plan              — appel modèle (Router, coder_planning_v1).
 *   3. edit               — appel modèle (Router, coder_coding_v1), applique les fichiers.
 *   4. diff                — git diff réel contre le commit baseline.
 *   5. verify_and_fix — TYPECHECK → LINT → TEST → BUILD → PREVIEW → BROWSER
 *      → VISION → CRITIC, puis boucle FIX bornée (READ FAILURE → DEBUG →
 *      FIX → RETEST, `security.maxFixIterations` itérations maximum,
 *      appel modèle Router coder_debugging_v1) — tout DANS un seul step
 *      Job Engine parce que le Job Engine attend un plan de LONGUEUR FIXE
 *      (voir jobs/types.ts) : la boucle bornée est interne à ce step,
 *      jamais une liste de steps de longueur variable.
 *
 * `buildCoderMissionSteps` est une FABRIQUE (jamais un plan statique) parce
 * qu'une mission Coder Agent varie par (dépôt source, périmètre de fichiers
 * autorisé, budget) — contrairement à "analyze_margin_risk" (un seul plan
 * fixe, voir registry.ts). Chaque step suit le contrat MissionStepDefinition
 * (types.ts) et est exécuté par missionRunner.ts (reprise/retry inchangés).
 *
 * Réutilisation RÉELLE du Router (§16) : chaque appel modèle (plan/edit/
 * debug/vision) passe par `chooseModel(taskSetName)` avec un taskSetName
 * DÉDIÉ par nature de tâche — jamais un modèle forcé en dur, jamais un
 * choix supposé sans mesure (voir router.ts : repli explicite vers
 * DEFAULT_MODEL tant qu'aucune évaluation réelle n'existe pour ce
 * taskSetName).
 */

export const PLANNING_TASK_SET = "coder_planning_v1";
export const CODING_TASK_SET = "coder_coding_v1";
export const DEBUGGING_TASK_SET = "coder_debugging_v1";

const planSchema = z.object({
  planDescription: z.string().min(1),
  targetFiles: z.array(z.string().min(1)).min(1).max(5),
});

const editSchema = z.object({
  files: z.array(z.object({ path: z.string().min(1), content: z.string() })).min(1),
});

function extractJson(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced?.[1] ?? trimmed).trim();
}

async function callStructuredModel<T>(
  provider: ModelProvider,
  taskSetName: string,
  system: string,
  userMessage: string,
  schema: z.ZodType<T>,
  maxTokens: number,
): Promise<{ data: T; provider: string; model: string; costUsd: number | null; tokensIn: number | null; tokensOut: number | null }> {
  const choice = await chooseModel(taskSetName);
  const result = await provider.generate({ model: choice.model, system, userMessage, maxTokens });
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(result.text));
  } catch {
    throw new Error(`Réponse du modèle ("${choice.model}", tâche "${taskSetName}") non parsable en JSON.`);
  }
  const validated = schema.safeParse(parsed);
  if (!validated.success) throw new Error(`Réponse du modèle non conforme au format attendu (${taskSetName}) : ${validated.error.message}`);
  return {
    data: validated.data,
    provider: provider.name,
    model: choice.model,
    costUsd: estimateCostUsd(provider, choice.model, result.tokensIn, result.tokensOut),
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
  };
}

export interface CoderMissionConfig {
  sourceRepoRoot: string;
  security: MissionSecurityBudget;
  previewPort: number;
  previewPath: string; // ex. "/settings" — page réellement vérifiée par le Browser Agent
  pageDescriptionForVision: string;
}

export function buildCoderMissionSteps(provider: ModelProvider, config: CoderMissionConfig): MissionStepDefinition[] {
  const { sourceRepoRoot, security, previewPort, previewPath, pageDescriptionForVision } = config;

  const inspect: MissionStepDefinition = {
    name: "inspect",
    async run(ctx) {
      const workspace = await createMissionWorkspace(ctx.missionId, sourceRepoRoot);
      const matches = await searchCode(workspace.root, "export default function", 20);
      return {
        output: {
          workspaceRoot: workspace.root,
          goal: (ctx.input as { goal: string }).goal,
          repoSummary: `Dépôt Next.js (App Router). ${matches.length} composant(s) page trouvé(s) via recherche "export default function". Périmètre autorisé pour cette mission : ${security.allowedPathPrefixes.join(", ")}.`,
        },
      };
    },
  };

  const plan: MissionStepDefinition = {
    name: "plan",
    async run(ctx) {
      const prior = ctx.input as { workspaceRoot: string; goal: string; repoSummary: string };
      const called = await callStructuredModel(
        provider,
        PLANNING_TASK_SET,
        `Tu es le Coder Agent d'OnDeal Intelligence (PLATFORM OWNER uniquement). On te donne un objectif et un résumé du dépôt. Réponds STRICTEMENT avec un objet JSON valide, sans texte autour, au format exact : {"planDescription": "...", "targetFiles": ["chemin/relatif.tsx", ...]}. "targetFiles" DOIT être un sous-ensemble de fichiers réellement existants et rester à l'intérieur de : ${security.allowedPathPrefixes.join(", ")} — jamais un fichier hors de ce périmètre.`,
        `Objectif : ${prior.goal}\n\nRésumé du dépôt : ${prior.repoSummary}`,
        planSchema,
        800,
      );
      return {
        output: { ...prior, plan: called.data },
        provider: called.provider,
        model: called.model,
        costUsd: called.costUsd ?? undefined,
        tokensIn: called.tokensIn ?? undefined,
        tokensOut: called.tokensOut ?? undefined,
      };
    },
  };

  const edit: MissionStepDefinition = {
    name: "edit",
    async run(ctx) {
      const prior = ctx.input as { workspaceRoot: string; goal: string; plan: { planDescription: string; targetFiles: string[] } };
      const currentContents = await Promise.all(
        prior.plan.targetFiles.map(async (f) => ({ path: f, content: await readFile(prior.workspaceRoot, f) })),
      );
      const called = await callStructuredModel(
        provider,
        CODING_TASK_SET,
        `Tu es le Coder Agent d'OnDeal Intelligence. On te donne un plan et le contenu ACTUEL des fichiers ciblés. Réponds STRICTEMENT avec un objet JSON valide, sans texte autour, au format exact : {"files": [{"path": "...", "content": "... contenu COMPLET du nouveau fichier ..."}]}. Chaque "path" DOIT être un des fichiers fournis, jamais un nouveau chemin. Le changement doit être PETIT, RÉVERSIBLE, purement visuel/textuel — jamais une mutation Shopify, jamais une modification de schema.prisma, jamais un appel réseau nouveau.`,
        `Plan : ${prior.plan.planDescription}\n\nFichiers actuels :\n${currentContents.map((f) => `--- ${f.path} ---\n${f.content}`).join("\n\n")}`,
        editSchema,
        4000,
      );
      for (const file of called.data.files) {
        await editFile(prior.workspaceRoot, file.path, security.allowedPathPrefixes, file.content);
      }
      return {
        output: { ...prior, editedFiles: called.data.files.map((f) => f.path) },
        provider: called.provider,
        model: called.model,
        costUsd: called.costUsd ?? undefined,
        tokensIn: called.tokensIn ?? undefined,
        tokensOut: called.tokensOut ?? undefined,
      };
    },
  };

  const diff: MissionStepDefinition = {
    name: "diff",
    async run(ctx) {
      const prior = ctx.input as { workspaceRoot: string };
      const diffText = await getDiff(prior.workspaceRoot);
      const diffPath = path.join(prior.workspaceRoot, ".mission-diff.patch");
      await fs.writeFile(diffPath, diffText, "utf8"); // artefact RÉEL sur disque, jamais un storageRef fictif
      return { output: { ...prior, diffText }, artifacts: [{ kind: "DIFF" as const, storageRef: diffPath, meta: { bytes: diffText.length } }] };
    },
  };

  /** Un seul essai de la chaîne mécanique+visuelle — jamais un état partiel silencieux : chaque échec porte sa raison exacte. */
  async function attemptVerification(
    root: string,
    attemptNumber: number,
  ): Promise<
    | { ok: true; visibleText: string; consoleMessages: Array<{ type: string }>; failedRequests: unknown[]; screenshotPath: string; criticReport: VisualCriticReport; criticProvider: string; criticModel: string; criticCostUsd: number | null }
    | { ok: false; reason: string; screenshotPath?: string }
  > {
    for (const [name, fn] of [
      ["typecheck", runTypecheck],
      ["lint", runLint],
      ["test", runTests],
      ["build", runBuild],
    ] as const) {
      const result = await fn(root, security.operationTimeoutMs);
      if (!result.ok) return { ok: false, reason: `${name} a échoué (timedOut=${result.timedOut}) : ${(result.stderr || result.stdout).slice(0, 2000)}` };
    }

    const server = await startPreviewServer(root, previewPort);
    try {
      const url = `${server.origin}${previewPath}`;
      const session = await openBrowser(url, [server.origin]);
      try {
        const visibleText = await getVisibleText(session);
        const consoleMessages = getConsoleMessages(session);
        const failedRequests = getFailedRequests(session);
        const screenshotBase64 = await screenshot(session);

        // Persisté sur disque (§18 Observability : "screenshots" doit être
        // un artefact réel, jamais seulement une donnée en mémoire perdue
        // en fin de step) — jamais le contenu binaire en base (même
        // principe que JobArtifact.storageRef, schema.prisma).
        const screenshotPath = path.join(root, `.mission-screenshot-attempt-${attemptNumber}.png`);
        await fs.writeFile(screenshotPath, Buffer.from(screenshotBase64, "base64"));

        const consoleErrors = consoleMessages.filter((m) => m.type === "error");
        if (consoleErrors.length > 0) return { ok: false, reason: `${consoleErrors.length} erreur(s) console navigateur : ${JSON.stringify(consoleErrors.slice(0, 5))}`, screenshotPath };
        if (failedRequests.length > 0) return { ok: false, reason: `${failedRequests.length} requête(s) réseau échouée(s) : ${JSON.stringify(failedRequests.slice(0, 5))}`, screenshotPath };

        const review = await reviewScreenshot(provider, screenshotBase64, { pageDescription: pageDescriptionForVision });
        const blockerIssues = review.report.issues.filter((i) => i.severity === "blocker" || i.severity === "high");
        if (!review.report.overallPass || blockerIssues.length > 0) {
          return { ok: false, reason: `Verdict visuel négatif : ${blockerIssues.map((i) => i.description).join(" | ") || "overallPass=false"}`, screenshotPath };
        }

        return {
          ok: true,
          visibleText,
          consoleMessages,
          failedRequests,
          screenshotPath,
          criticReport: review.report,
          criticProvider: review.provider,
          criticModel: review.model,
          criticCostUsd: review.costUsd,
        };
      } finally {
        await closeBrowser(session);
      }
    } finally {
      stopPreviewServer(server);
    }
  }

  /**
   * Step composite unique (§7/§11/§20 : TYPECHECK → LINT → TEST → BUILD →
   * PREVIEW → BROWSER → VISION → CRITIC, puis boucle FIX bornée par
   * `security.maxFixIterations` — NO BLIND LOOP). Chaque itération est
   * journalisée dans `iterations` (Observability, §18) : jamais une reprise
   * silencieuse sans trace de ce qui a échoué et de ce qui a été corrigé.
   */
  const verifyAndFix: MissionStepDefinition = {
    name: "verify_and_fix",
    async run(ctx) {
      const prior = ctx.input as { workspaceRoot: string; goal: string; plan: { planDescription: string }; editedFiles: string[] };
      const iterations: Array<{ attempt: number; ok: boolean; reason?: string; fixedFiles?: string[]; screenshotPath?: string }> = [];
      const artifacts: Array<{ kind: "SCREENSHOT"; storageRef: string; meta?: Record<string, unknown> }> = [];
      let totalCostUsd = 0;

      for (let attempt = 1; attempt <= security.maxFixIterations + 1; attempt++) {
        const result = await attemptVerification(prior.workspaceRoot, attempt);
        if (result.ok) {
          iterations.push({ attempt, ok: true, screenshotPath: result.screenshotPath });
          artifacts.push({ kind: "SCREENSHOT", storageRef: result.screenshotPath, meta: { attempt, finalAttempt: true } });
          if (result.criticCostUsd) totalCostUsd += result.criticCostUsd;
          // PAS de cleanupWorkspace() ici, volontairement : les artefacts
          // (diff, captures d'écran) référencés par storageRef doivent
          // rester lisibles après le succès de la mission (Observability,
          // §18) — le workspace n'est réclamé que plus tard, par
          // reapStaleWorkspaces() (voir workspace.ts), au même titre qu'un
          // workspace de mission ÉCHOUÉE (déjà jamais nettoyé sur le champ,
          // pour le post-mortem). Cleanup uniforme = un seul mécanisme à
          // auditer, jamais deux chemins de nettoyage à maintenir en
          // cohérence.
          return {
            output: { success: true, iterations, criticReport: result.criticReport, editedFiles: prior.editedFiles },
            provider: result.criticProvider,
            model: result.criticModel,
            costUsd: totalCostUsd > 0 ? totalCostUsd : 0,
            artifacts,
          };
        }

        iterations.push({ attempt, ok: false, reason: result.reason, screenshotPath: result.screenshotPath });
        if (result.screenshotPath) artifacts.push({ kind: "SCREENSHOT", storageRef: result.screenshotPath, meta: { attempt, finalAttempt: false } });
        if (attempt > security.maxFixIterations) {
          throw new Error(`Vérification échouée après ${attempt} tentative(s) (${security.maxFixIterations} correction(s) autorisée(s)) : ${result.reason}`);
        }

        // READ FAILURE → DEBUG → FIX (§7) : le modèle reçoit la raison exacte
        // de l'échec et le contenu actuel des fichiers édités, doit renvoyer
        // un nouveau contenu complet — même schéma qu'"edit", jamais un
        // patch partiel ambigu.
        const currentContents = await Promise.all(
          prior.editedFiles.map(async (f) => ({ path: f, content: await readFile(prior.workspaceRoot, f) })),
        );
        const fix = await callStructuredModel(
          provider,
          DEBUGGING_TASK_SET,
          `Tu es le Coder Agent d'OnDeal Intelligence en mode DEBUG. La vérification précédente a échoué. Réponds STRICTEMENT avec un objet JSON valide, sans texte autour, au format exact : {"files": [{"path": "...", "content": "... contenu COMPLET corrigé ..."}]}. Chaque "path" DOIT être un des fichiers fournis, jamais un nouveau chemin. Corrige UNIQUEMENT ce qui est nécessaire pour lever l'échec rapporté — reste dans l'esprit du plan initial.`,
          `Objectif original : ${prior.goal}\nPlan original : ${prior.plan.planDescription}\nÉchec rapporté (tentative ${attempt}) : ${result.reason}\n\nFichiers actuels :\n${currentContents.map((f) => `--- ${f.path} ---\n${f.content}`).join("\n\n")}`,
          editSchema,
          4000,
        );
        totalCostUsd += fix.costUsd ?? 0;
        for (const file of fix.data.files) {
          await editFile(prior.workspaceRoot, file.path, security.allowedPathPrefixes, file.content);
        }
        iterations[iterations.length - 1]!.fixedFiles = fix.data.files.map((f) => f.path);
      }

      // Inatteignable (la boucle throw ou return avant) — garde défensive explicite plutôt qu'un flux implicite.
      throw new Error("État inattendu en sortie de boucle verify_and_fix.");
    },
  };

  return [inspect, plan, edit, diff, verifyAndFix];
}
