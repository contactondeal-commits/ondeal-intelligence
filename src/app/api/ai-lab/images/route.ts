import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { CapabilityError, requireCapabilityWithOwnerSession } from "@/lib/authz/capabilities";
import { OwnerAuthError } from "@/lib/authz/ownerSession";
import { resolveDefaultImageProvider } from "@/lib/ai/providers/imageGeneration";
import { appendAuditLog } from "@/lib/ai/policy/audit";

/**
 * ONDEAL AI CORE — §41/§202 "provider de génération d'image" (06/09/2026),
 * clôture réelle.
 *
 * Génère une image RÉELLE (OpenAI Images API, dall-e-3) à partir d'un
 * prompt Owner — appelant réel du Tool Registry "create_image"
 * (tools/registry.ts), jusqu'ici honnêtement toujours NOT_CONFIGURED.
 *
 * Dépense réelle (§ même convention que POST /api/ai-lab/experiments) :
 * requireCapabilityWithOwnerSession("SYSTEM_CODER") — usage normal du
 * Control Plane par l'Owner déjà authentifié, jamais un changement de
 * configuration système (donc pas de step-up).
 *
 * Aucune persistance en base de l'image elle-même (pas de nouveau modèle
 * Prisma, pas de migration) — même principe que la revue Visual Reviewer
 * du Coder Agent tant qu'aucune mission ne la référence : l'image RÉELLE
 * (base64 PNG) est retournée directement au client et affichée dans
 * l'onglet Images d'AiLabConsole.tsx ; seule sa PROVENANCE (prompt,
 * coût, modèle) est journalisée via AiLabAuditLog — jamais l'image
 * elle-même dans un champ texte libre.
 */
const bodySchema = z
  .object({
    prompt: z.string().min(1).max(2000),
    size: z.enum(["1024x1024", "1024x1792", "1792x1024"]).optional(),
    quality: z.enum(["standard", "hd"]).optional(),
  })
  .strict();

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

  const provider = resolveDefaultImageProvider();
  try {
    const result = await provider.generateImage(parsed.data);
    await appendAuditLog({
      actorUserId: userId,
      action: "image_generate",
      toolId: "create_image",
      provider: result.provider,
      model: result.model,
      costUsd: result.costUsd ?? undefined,
      reason: `Image générée à partir du prompt : "${parsed.data.prompt.slice(0, 300)}"${result.revisedPrompt ? ` (prompt révisé par le modèle : "${result.revisedPrompt.slice(0, 300)}")` : ""}.`,
      resultStatus: "SUCCESS",
    });
    return NextResponse.json({
      imageBase64: result.imageBase64,
      mediaType: result.mediaType,
      provider: result.provider,
      model: result.model,
      revisedPrompt: result.revisedPrompt,
      costUsd: result.costUsd,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await appendAuditLog({
      actorUserId: userId,
      action: "image_generate",
      toolId: "create_image",
      reason: `Échec de génération d'image pour le prompt : "${parsed.data.prompt.slice(0, 300)}" — ${message}`,
      resultStatus: "FAILURE",
    });
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
