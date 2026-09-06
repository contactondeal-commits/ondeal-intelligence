import path from "node:path";
import { prisma } from "@/lib/db";
import { AnthropicProvider } from "@/lib/ai/providers/anthropic";
import { claimMissionById, getMission } from "@/lib/ai/coder/missionStore";
import { runMissionToCompletion } from "@/lib/ai/coder/missionRunner";
import { buildCoderMissionSteps } from "@/lib/ai/coder/steps";
import { reapStaleWorkspaces } from "@/lib/ai/coder/workspace";

/**
 * ONDEAL AI CORE — PHASE 3 : exécuteur RÉEL des missions Coder Agent
 * (06/09/2026).
 *
 * C'est ici, et SEULEMENT ici (jamais dans une route Vercel — voir
 * src/app/api/coder-missions/route.ts), que `runMissionToCompletion`
 * s'exécute pour de vrai : ce process a besoin d'un accès filesystem
 * persistant (checkout git, workspace de mission) et de Chromium
 * (Playwright), deux choses qu'une fonction serverless Vercel n'offre pas
 * de façon fiable (voir le rapport de session, "DEV PROOF vs PRODUCT
 * RUNTIME"). Appelable aujourd'hui depuis ce sandbox de développement
 * (preuve du vertical slice PHASE 3) ; demain depuis un runner GitHub
 * Actions déclenché par le Job Engine (voir .github/workflows/
 * coder-mission.yml — conçu, PAS ENCORE câblé en déclenchement live).
 *
 * Usage : tsx scripts/run-coder-mission.ts --mission <id> --repo <path> --port <port> --path </settings> --page-description "..."
 */
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
  const missionId = arg("mission");
  const repoRoot = path.resolve(arg("repo"));
  const port = Number(arg("port", "3917"));
  const previewPath = arg("path", "/");
  const pageDescription = arg("page-description", "Page interne OnDeal Intelligence.");

  await reapStaleWorkspaces(2 * 60 * 60 * 1000); // réclame les workspaces de missions précédentes de plus de 2h (§19 self-review, "stale workspace")

  const claimed = await claimMissionById(missionId);
  if (!claimed) {
    console.error(`Mission "${missionId}" non éligible (introuvable, ou pas QUEUED/WAITING_RETRY).`);
    process.exitCode = 1;
    return;
  }

  const provider = new AnthropicProvider();
  const steps = buildCoderMissionSteps(provider, {
    sourceRepoRoot: repoRoot,
    security: {
      allowedPathPrefixes: ["src/app", "src/components"],
      maxCostUsd: 2,
      maxFixIterations: 2,
      operationTimeoutMs: 120_000,
    },
    previewPort: port,
    previewPath,
    pageDescriptionForVision: pageDescription,
  });

  const outcome = await runMissionToCompletion(claimed, steps, { maxDurationMs: 15 * 60 * 1000 });
  const final = await getMission(missionId);
  console.log(JSON.stringify({ outcome, mission: final ? { status: final.status, currentStepIndex: final.currentStepIndex, lastError: final.lastError } : null }, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
