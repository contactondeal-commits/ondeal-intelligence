import path from "node:path";
import { prisma } from "@/lib/db";
import { AnthropicProvider } from "@/lib/ai/providers/anthropic";
import { runStorefrontMission } from "@/lib/ai/supervisor/graphRunner";
import { reapStaleWorkspaces } from "@/lib/ai/coder/workspace";

/**
 * ONDEAL AI CORE — PHASE 5 : exécuteur RÉEL des missions AI Lab Ultimate
 * (06/09/2026), CLI dev-sandbox — même principe que
 * scripts/run-coder-mission.ts (Phase 3) : nécessaire dès qu'une mission
 * planifie un node "coder_implementation" (checkout git persistant +
 * Chromium, absents d'une fonction Vercel — voir
 * api/ai-lab/missions/[id]/run/route.ts pour la frontière honnête).
 *
 * Usage : tsx scripts/run-ai-lab-mission.ts --mission <id> --repo <path> --port <port> [--max-wall-clock-ms <ms>] [--hard-budget-usd <usd>]
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
  const port = Number(arg("port", "4700"));
  const maxWallClockMs = arg("max-wall-clock-ms", "") ? Number(arg("max-wall-clock-ms")) : undefined;
  const hardBudgetUsd = arg("hard-budget-usd", "") ? Number(arg("hard-budget-usd")) : undefined;
  const createdByUserId = arg("user");

  await reapStaleWorkspaces(2 * 60 * 60 * 1000);

  const provider = new AnthropicProvider();
  const outcome = await runStorefrontMission(missionId, {
    provider,
    sourceRepoRoot: repoRoot,
    createdByUserId,
    coderSecurity: { allowedPathPrefixes: ["src/app", "src/components"], maxCostUsd: 2, maxFixIterations: 2, operationTimeoutMs: 180_000 },
    coderPreviewPort: port,
    maxWallClockMs,
    hardBudgetUsd,
  });
  console.log(JSON.stringify({ outcome }, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
