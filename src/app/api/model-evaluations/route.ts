import { NextResponse } from "next/server";
import { CapabilityError, requireCapability } from "@/lib/authz/capabilities";
import { prisma } from "@/lib/db";

/**
 * ONDEAL AI CORE — PHASE 2 (06/09/2026).
 *
 * CONTROL PLANE, pas Merchant Plane : lecture des runs d'évaluation
 * multi-modèles (télémétrie interne de comparaison de modèles, jamais une
 * donnée client — voir schema.prisma, ModelEvalRun). Gate
 * `requireCapability("AI_EVAL_READ")` — un VIEWER (ou même un OWNER) d'une
 * boutique cliente n'y a PAS accès seulement parce qu'il est authentifié :
 * seul le propriétaire plateforme OnDeal possède cette capacité.
 */
export async function GET() {
  try {
    await requireCapability("AI_EVAL_READ");
  } catch (err) {
    if (err instanceof CapabilityError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }

  const runs = await prisma.modelEvalRun.findMany({
    orderBy: { createdAt: "desc" },
    take: 20,
    include: { results: { orderBy: { createdAt: "asc" } } },
  });

  return NextResponse.json({
    runs: runs.map((run) => ({
      id: run.id,
      taskSetName: run.taskSetName,
      createdAt: run.createdAt,
      results: run.results.map((r) => ({
        provider: r.provider,
        model: r.model,
        taskName: r.taskName,
        passed: r.passed,
        reason: r.reason,
        latencyMs: r.latencyMs,
        tokensIn: r.tokensIn,
        tokensOut: r.tokensOut,
        costUsd: r.costUsd,
      })),
    })),
  });
}
