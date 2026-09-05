import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { decryptJson } from "@/lib/crypto";
import { requireStoreAccess, requireRole, ADMIN_ROLES, AuthError } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import type { GoogleAnalyticsCredentials } from "@/lib/integrations/google-analytics";
import { encryptGaCredentials, syncGoogleAnalytics } from "@/lib/sync/googleAnalyticsStore";

const bodySchema = z
  .object({
    storeId: z.string().min(1).max(64),
    propertyId: z.string().trim().regex(/^properties\/\d+$/, "Format attendu : properties/123456789"),
    displayName: z.string().trim().min(1).max(200),
  })
  .strict();

// Finalise la connexion Google Analytics : enregistre la propriété GA4
// choisie par le marchand (jamais devinée — voir /properties pour la liste
// vérifiée auprès de Google) puis lance une première synchronisation.
export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Champs manquants ou invalides." }, { status: 400 });
  const { storeId, propertyId, displayName } = parsed.data;

  let userId: string;
  try {
    const access = await requireStoreAccess(storeId);
    userId = access.userId;
    requireRole(access.role, ADMIN_ROLES);
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }

  const integration = await prisma.integration.findUnique({ where: { storeId_provider: { storeId, provider: "GOOGLE_ANALYTICS" } } });
  if (!integration || integration.status !== "CONNECTED" || !integration.encryptedCredentials) {
    return NextResponse.json({ error: "Google Analytics n'est pas encore autorisé pour cette boutique." }, { status: 409 });
  }

  const existing = decryptJson<GoogleAnalyticsCredentials>(integration.encryptedCredentials);
  const updated: GoogleAnalyticsCredentials = { refreshToken: existing.refreshToken, propertyId, propertyDisplayName: displayName };

  await prisma.integration.update({ where: { id: integration.id }, data: { encryptedCredentials: encryptGaCredentials(updated) } });

  await logAudit({
    storeId,
    userId,
    actorType: "user",
    event: "integration.google_analytics_property_selected",
    message: `Propriété GA4 sélectionnée : ${displayName} (${propertyId}).`,
  });

  // Première synchronisation immédiate — best-effort : un échec ici est
  // rattrapé par le cron planifié, il ne doit pas faire échouer la sélection
  // elle-même (la propriété EST enregistrée, quoi qu'il arrive ci-dessous).
  const sync = await syncGoogleAnalytics(storeId, "manual").catch((err) => {
    console.error("[google-analytics/select-property] échec de la synchronisation initiale", {
      storeId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  });

  return NextResponse.json({ ok: true, sync: sync?.status ?? "error" });
}
