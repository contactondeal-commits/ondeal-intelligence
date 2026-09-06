import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { CapabilityError, requireCapabilityWithOwnerSession, requireCapabilityWithStepUp } from "@/lib/authz/capabilities";
import { OwnerAuthError } from "@/lib/authz/ownerSession";
import { setModelConfig, deleteModelConfig, listModelConsole } from "@/lib/ai/models/registry";
import { appendAuditLog } from "@/lib/ai/policy/audit";

/**
 * ONDEAL AI CORE — §18 "Model Console écrivable" (06/09/2026), clôture réelle.
 *
 * POST : upsert d'UNE ligne ModelConfig (enable/disable/set-default/
 * force-for-test/max-cost/provider-priority) — effet RUNTIME immédiat sur la
 * PROCHAINE mission (router.ts.resolveFailoverCandidates lit cette même
 * table). PATCH/DELETE non nécessaires ici : "supprimer l'override" est un
 * cas de POST avec removeOverride:true (voir schema) plutôt qu'une route
 * séparée — un seul point d'entrée écrit, jamais deux chemins divergents.
 *
 * Step-up requis : changer quel modèle/provider répond à une mission est une
 * action à effet direct sur le coût et la qualité de TOUTES les missions
 * suivantes — jamais ALLOW_AUTO sans re-preuve de possession de clé (§5).
 */
const bodySchema = z
  .object({
    provider: z.enum(["anthropic", "openai"]),
    model: z.string().min(1).max(200),
    removeOverride: z.boolean().optional(),
    enabled: z.boolean().optional(),
    isDefault: z.boolean().optional(),
    forceForTestMinutes: z.number().int().min(1).max(24 * 60).nullable().optional(),
    maxCostPerCallUsd: z.number().positive().nullable().optional(),
    providerPriority: z.number().int().min(0).max(1000).optional(),
  })
  .strict();

export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Paramètres invalides.", details: parsed.error.flatten() }, { status: 400 });

  let userId: string;
  try {
    ({ userId } = await requireCapabilityWithStepUp("AI_MODEL_ADMIN"));
  } catch (err) {
    if (err instanceof CapabilityError || err instanceof OwnerAuthError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }

  const { provider, model, removeOverride } = parsed.data;

  try {
    if (removeOverride) {
      await deleteModelConfig(provider, model);
      await appendAuditLog({ actorUserId: userId, action: "model_config_override_removed", reason: `Override ModelConfig supprimé pour ${provider}/${model} — repli sur le comportement par défaut du Router.`, resultStatus: "SUCCESS" });
      return NextResponse.json({ ok: true });
    }

    const saved = await setModelConfig(userId, parsed.data);
    await appendAuditLog({
      actorUserId: userId,
      action: "model_config_updated",
      reason: `ModelConfig ${provider}/${model} mis à jour (enabled=${saved.enabled}, isDefault=${saved.isDefault}, providerPriority=${saved.providerPriority}, maxCostPerCallUsd=${saved.maxCostPerCallUsd ?? "aucun"}, forceForTestUntil=${saved.forceForTestUntil?.toISOString() ?? "aucun"}).`,
      resultStatus: "SUCCESS",
    });
    return NextResponse.json({ ok: true, config: saved });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Échec de la mise à jour du Model Console.";
    await appendAuditLog({ actorUserId: userId, action: "model_config_updated", reason: message, resultStatus: "FAILURE" });
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function GET() {
  try {
    await requireCapabilityWithOwnerSession("AI_MODEL_ADMIN"); // lecture : session Owner valide suffit, pas de step-up (réservé aux écritures/actions à effet réel)
  } catch (err) {
    if (err instanceof CapabilityError || err instanceof OwnerAuthError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }
  return NextResponse.json({ models: await listModelConsole() });
}
