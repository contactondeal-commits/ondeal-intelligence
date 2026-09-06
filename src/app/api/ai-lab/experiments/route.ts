import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { CapabilityError, requireCapabilityWithOwnerSession } from "@/lib/authz/capabilities";
import { OwnerAuthError } from "@/lib/authz/ownerSession";
import { EXPERIMENT_DIMENSIONS, listExperiments, runExperiment } from "@/lib/ai/experiments/run";
import { appendAuditLog } from "@/lib/ai/policy/audit";

/**
 * ONDEAL AI CORE — §51/§52 "Experiment Mode" (06/09/2026), clôture réelle.
 *
 * GET : liste des Experiments réellement exécutés (jamais une page vide
 * décorative) — même gate de lecture que agents/memory (AI_EVAL_READ +
 * PlatformOwnerSession, §90).
 * POST : lance un Experiment réel — dépense réelle (au moins 2 vrais appels
 * modèle + 1 par variante pour la notation indépendante), donc
 * requireCapabilityWithOwnerSession("SYSTEM_CODER") : même capacité que
 * lancer une mission (missions/[id]/run), pas requireCapabilityWithStepUp —
 * ce n'est pas un changement de configuration système (Model Console/Agent
 * Registry), c'est un usage normal du Control Plane par l'Owner déjà
 * authentifié via PlatformOwnerSession.
 */
const variantSchema = z.object({
  label: z.string().min(1).max(40),
  provider: z.enum(["anthropic", "openai"]).optional(),
  model: z.string().min(1).max(200).optional(),
  promptVariant: z.string().min(1).max(4000).optional(),
});

const bodySchema = z
  .object({
    objective: z.string().min(1).max(4000),
    dimension: z.enum(EXPERIMENT_DIMENSIONS as [string, ...string[]]),
    variants: z.array(variantSchema).min(2).max(6),
  })
  .strict();

export async function GET() {
  try {
    await requireCapabilityWithOwnerSession("AI_EVAL_READ");
  } catch (err) {
    if (err instanceof CapabilityError || err instanceof OwnerAuthError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }
  const experiments = await listExperiments(50);
  return NextResponse.json({ experiments });
}

export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Paramètres invalides.", details: parsed.error.flatten() }, { status: 400 });

  let userId: string;
  try {
    ({ userId } = await requireCapabilityWithOwnerSession("SYSTEM_CODER"));
  } catch (err) {
    if (err instanceof CapabilityError || err instanceof OwnerAuthError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }

  try {
    const summary = await runExperiment({
      objective: parsed.data.objective,
      dimension: parsed.data.dimension as "MODEL" | "PROMPT" | "STRATEGY" | "AGENT",
      createdByUserId: userId,
      variants: parsed.data.variants,
    });
    await appendAuditLog({
      actorUserId: userId,
      action: "experiment_run",
      reason: `Experiment "${parsed.data.dimension}" exécuté (${parsed.data.variants.length} variantes) sur objectif : ${parsed.data.objective.slice(0, 200)}. Statut final : ${summary.status}${summary.winnerVariantId ? `, gagnant=${summary.winnerVariantId}` : ""}.`,
      resultStatus: summary.status === "COMPLETED" ? "SUCCESS" : "FAILURE",
    });
    return NextResponse.json({ experiment: summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
