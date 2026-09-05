import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { decryptJson } from "@/lib/crypto";
import { requireStoreAccess, requireRole, ADMIN_ROLES, AuthError } from "@/lib/auth";
import { refreshGaAccessToken, listGaProperties, type GoogleAnalyticsCredentials } from "@/lib/integrations/google-analytics";

// Liste les propriétés GA4 accessibles au compte Google déjà autorisé pour
// cette boutique — étape intermédiaire entre le retour OAuth (callback) et
// le choix définitif (select-property). Lecture seule, aucun état modifié.
export async function GET(req: NextRequest) {
  const storeId = req.nextUrl.searchParams.get("store");
  if (!storeId) return NextResponse.json({ error: "Paramètre 'store' manquant." }, { status: 400 });

  try {
    const access = await requireStoreAccess(storeId);
    requireRole(access.role, ADMIN_ROLES);
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }

  const integration = await prisma.integration.findUnique({ where: { storeId_provider: { storeId, provider: "GOOGLE_ANALYTICS" } } });
  if (!integration || integration.status !== "CONNECTED" || !integration.encryptedCredentials) {
    return NextResponse.json({ error: "Google Analytics n'est pas encore autorisé pour cette boutique." }, { status: 409 });
  }

  try {
    const creds = decryptJson<GoogleAnalyticsCredentials>(integration.encryptedCredentials);
    const accessToken = await refreshGaAccessToken(creds.refreshToken);
    const properties = await listGaProperties(accessToken);
    return NextResponse.json({ properties, currentPropertyId: creds.propertyId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Impossible de lister vos propriétés Google Analytics : ${message}` }, { status: 502 });
  }
}
