import path from "node:path";
import { readFileSync } from "node:fs";
import { prisma } from "@/lib/db";
import type { GenerateRequest, GenerateResult, ModelCapabilities, ModelProvider } from "@/lib/ai/providers/provider";
import { createMission, claimMissionById, getMission } from "@/lib/ai/coder/missionStore";
import { runMissionToCompletion } from "@/lib/ai/coder/missionRunner";
import { buildCoderMissionSteps } from "@/lib/ai/coder/steps";

/**
 * ONDEAL AI CORE — PHASE 3 : SIMULATION du Coder Agent, JAMAIS la
 * production (06/09/2026).
 *
 * Exécute RÉELLEMENT toute la mécanique (workspace isolé, git diff réel,
 * typecheck/lint/test/build réels, serveur de preview réel, navigateur
 * Playwright réel, écriture RÉELLE dans coder_missions/coder_mission_steps)
 * — SEUL le "modèle" est un double scripté (ScriptedProvider ci-dessous),
 * fourni au moment de l'appel plutôt qu'un vrai AnthropicProvider, pour un
 * environnement sans ANTHROPIC_API_KEY. Sert à vérifier la mécanique du
 * Coder Agent SANS dépenser un vrai appel modèle — jamais utilisé par
 * scripts/run-coder-mission.ts (le runner réel, qui instancie
 * `new AnthropicProvider()`).
 *
 * `responses` est fourni par l'appelant (jamais une réponse générique
 * inventée par ce fichier) — voir l'usage dans le rapport de session.
 */
class ScriptedProvider implements ModelProvider {
  readonly name = "anthropic";
  constructor(private responses: { plan: string; edit: string; vision: string; debug?: string }) {}

  capabilities(model: string): ModelCapabilities | null {
    return { maxContextTokens: 200_000, vision: true, toolUse: true, costPerMTokIn: 1, costPerMTokOut: 5 };
  }

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    let text: string;
    if (req.images && req.images.length > 0) text = this.responses.vision;
    else if (req.system.includes("mode DEBUG")) text = this.responses.debug ?? this.responses.edit;
    else if (req.system.includes('"planDescription"')) text = this.responses.plan;
    else text = this.responses.edit;
    return { text, citations: [], tokensIn: Math.ceil(req.userMessage.length / 4), tokensOut: Math.ceil(text.length / 4) };
  }
}

function arg(name: string, fallback?: string): string {
  const idx = process.argv.indexOf(`--${name}`);
  const value = idx >= 0 ? process.argv[idx + 1] : undefined;
  if (!value) {
    if (fallback !== undefined) return fallback;
    throw new Error(`Argument --${name} requis.`);
  }
  return value;
}

async function main() {
  const goal = arg("goal");
  const repoRoot = path.resolve(arg("repo"));
  const port = Number(arg("port", "3917"));
  const previewPath = arg("path", "/");
  const pageDescription = arg("page-description", "Page interne OnDeal Intelligence.");
  const planJson = readFileSync(arg("plan-json-file"), "utf8");
  const editJson = readFileSync(arg("edit-json-file"), "utf8");
  const visionJson = readFileSync(arg("vision-json-file"), "utf8");
  const debugJsonFile = arg("debug-json-file", "");
  const debugJson = debugJsonFile ? readFileSync(debugJsonFile, "utf8") : "";

  const mission = await createMission({ goal, createdByUserId: "cl_simulation_platform_owner" });
  console.log(`Mission créée : ${mission.id}`);

  const claimed = await claimMissionById(mission.id);
  if (!claimed) throw new Error("Échec de la réclamation de la mission simulée.");

  const provider = new ScriptedProvider({ plan: planJson, edit: editJson, vision: visionJson, debug: debugJson || undefined });
  const steps = buildCoderMissionSteps(provider, {
    sourceRepoRoot: repoRoot,
    security: { allowedPathPrefixes: ["src/app", "src/components"], maxCostUsd: 2, maxFixIterations: 2, operationTimeoutMs: 120_000 },
    previewPort: port,
    previewPath,
    pageDescriptionForVision: pageDescription,
  });

  const outcome = await runMissionToCompletion(claimed, steps, { maxDurationMs: 15 * 60 * 1000 });
  const final = await getMission(mission.id);
  console.log(
    JSON.stringify(
      {
        outcome,
        mission: final
          ? {
              id: final.id,
              status: final.status,
              currentStepIndex: final.currentStepIndex,
              lastError: final.lastError,
              steps: final.steps.map((s) => ({ index: s.index, attempt: s.attempt, name: s.name, status: s.status, provider: s.provider, model: s.model, costUsd: s.costUsd })),
            }
          : null,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
