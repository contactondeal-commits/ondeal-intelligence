import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, requireStoreAccess } from "@/lib/auth";
import { CapabilityError, requireCapability } from "@/lib/authz/capabilities";
import { logAudit } from "@/lib/audit";
import { runModelEvaluation, DEFAULT_EVAL_MODELS } from "@/lib/ai/models/evaluation";
import { GROUNDING_TASK_SET } from "@/lib/ai/models/tasks";

/**
 * ONDEAL AI CORE — PHASE 2 (06/09/2026).
 *
 * CONTROL PLANE, pas Merchant Plane (voir authz/capabilities.ts) : déclenche
 * un run RÉEL d'évaluation multi-modèles (dépense réelle, minime — voir
 * evaluation.ts) qui influence un choix de modèle PLATEFORME, jamais une
 * donnée d'UNE boutique. Le gate d'autorisation est `requireCapability
 * ("AI_MODEL_ADMIN")` — indépendant de tout rôle Membership, y compris
 * Role.OWNER d'une organisation cliente ("STORE ADMIN ≠ ONDEAL OWNER").
 *
 * `storeId` reste dans le corps de la requête UNIQUEMENT pour la
 * traçabilité (AuditLog.storeId est requis en base — voir schema.prisma) :
 * `requireStoreAccess` ici sert seulement à valider que ce storeId existe
 * et que l'appelant y a un accès réel, PAS à accorder la permission
 * Control Plane elle-même (qui vient exclusivement de requireCapability,
 * au-dessus). Un OWNER d'une boutique cliente qui n'est PAS le propriétaire
 * plateforme échoue sur requireCapability, quel que soit son storeId.
 */
const bodySchema = z
  .object({
    storeId: z.string().min(1).max(64),
    models: z.array(z.string().min(1).max(64)).min(1).max(10).optional(),
  })
  .strict();

export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Paramètres invalides." }, { status: 400 });
  const { storeId, models } = parsed.data;

  let userId: string;
  try {
    const capability = await requireCapability("AI_MODEL_ADMIN");
    userId = capability.userId;
    await requireStoreAccess(storeId); // validation du contexte d'audit uniquement — voir commentaire ci-dessus
  } catch (err) {
    if (err instanceof CapabilityError || err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }

  const summary = await runModelEvaluation({ models: models ?? DEFAULT_EVAL_MODELS });

  const passed = summary.results.filter((r) => r.passed).length;
  const totalCostUsd = summary.results.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);

  await logAudit({
    storeId,
    userId,
    actorType: "user",
    event: "model_evaluation.run",
    message: `Évaluation multi-modèles "${GROUNDING_TASK_SET}" exécutée (${summary.results.length} résultat(s), ${passed} réussi(s), coût réel ≈ ${totalCostUsd.toFixed(6)}$).`,
    meta: { runId: summary.runId, resultsCount: summary.results.length, passed, totalCostUsd },
  });

  return NextResponse.json(
    { runId: summary.runId, taskSetName: summary.taskSetName, results: summary.results, totalCostUsd },
    { status: 201 },
  );
}
