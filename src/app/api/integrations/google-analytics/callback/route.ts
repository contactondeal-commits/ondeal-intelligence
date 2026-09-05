import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { encryptJson } from "@/lib/crypto";
import { requireStoreAccess, AuthError } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { verifyGaOAuthState, exchangeGaCodeForTokens, type GoogleAnalyticsCredentials } from "@/lib/integrations/google-analytics";

// GOOGLE ANALYTICS — retour d'autorisation Google. Aucune valeur n'est
// inventée : en cas d'échec à n'importe quelle étape, la connexion est
// refusée avec un message clair plutôt que de créer un état partiel
// silencieux (même discipline que /api/shopify/callback).
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const error = params.get("error");
  const code = params.get("code");
  const state = params.get("state");

  if (error) {
    // Le marchand a refusé le consentement, ou une erreur Google — retour
    // propre vers Paramètres plutôt qu'une page d'erreur brute.
    return NextResponse.redirect(`${req.nextUrl.origin}/settings/integrations?gaError=${encodeURIComponent(error)}`, { status: 302 });
  }
  if (!code || !state) {
    return NextResponse.json({ error: "Paramètres OAuth Google manquants." }, { status: 400 });
  }

  const stateResult = await verifyGaOAuthState(state);
  if (!stateResult) {
    return NextResponse.json({ error: "Session d'autorisation invalide ou expirée. Relancez la connexion depuis Paramètres." }, { status: 401 });
  }
  const { storeId } = stateResult;

  // Revérifie l'accès APRÈS le retour de Google (la session en cours a pu
  // changer entre-temps) — ne fait jamais confiance à la seule présence de
  // storeId dans l'état signé.
  try {
    await requireStoreAccess(storeId);
  } catch (err) {
    const status = err instanceof AuthError ? 403 : 500;
    return NextResponse.json(
      { error: "Vous n'êtes plus authentifié·e ou n'avez plus accès à cette boutique. Reconnectez-vous puis réessayez." },
      { status },
    );
  }

  try {
    const { refreshToken } = await exchangeGaCodeForTokens(code);
    const creds: GoogleAnalyticsCredentials = { refreshToken, propertyId: null, propertyDisplayName: null };

    await prisma.integration.upsert({
      where: { storeId_provider: { storeId, provider: "GOOGLE_ANALYTICS" } },
      create: { storeId, provider: "GOOGLE_ANALYTICS", status: "CONNECTED", encryptedCredentials: encryptJson(creds) },
      update: { status: "CONNECTED", encryptedCredentials: encryptJson(creds), lastError: null },
    });

    await logAudit({
      storeId,
      actorType: "user",
      event: "integration.oauth_installed",
      message: "Google Analytics autorisé — sélection de la propriété GA4 en attente.",
    });

    // Redirige vers Paramètres > Intégrations avec un indicateur : la carte
    // Google Analytics y affiche alors le sélecteur de propriété (voir
    // GoogleAnalyticsCard.tsx + /api/integrations/google-analytics/properties).
    return NextResponse.redirect(`${req.nextUrl.origin}/settings/integrations?store=${storeId}&connected=google_analytics`, { status: 302 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[google-analytics/callback] échec de l'autorisation", { storeId, error: message });
    return NextResponse.redirect(
      `${req.nextUrl.origin}/settings/integrations?store=${storeId}&gaError=${encodeURIComponent(message)}`,
      { status: 302 },
    );
  }
}
