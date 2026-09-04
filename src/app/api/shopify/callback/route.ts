import { NextRequest, NextResponse } from "next/server";
import { createSession, setSessionCookie } from "@/lib/auth";
import { normalizeMyshopifyDomain } from "@/lib/integrations/shopify-domain";
import type { ShopifyCredentials } from "@/lib/integrations/shopify";
import {
  verifyOAuthCallbackHmac,
  verifyOAuthState,
  exchangeCodeForAccessToken,
  fetchShopInfo,
} from "@/lib/integrations/shopify-oauth";
import { provisionStoreFromShopifyAuth } from "@/lib/integrations/shopify-provision";

// COMMERCIALISATION — retour d'autorisation Shopify. Crée ou retrouve
// l'Organization/Store correspondant à la boutique, connecte l'intégration
// Shopify, enregistre les webhooks obligatoires, puis ouvre une session pour
// le marchand. AUCUNE valeur n'est inventée : en cas d'échec à n'importe
// quelle étape, l'installation est refusée avec un message clair plutôt que
// de créer un état partiel silencieux.
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const shop = normalizeMyshopifyDomain(params.get("shop"));
  const code = params.get("code");
  const state = params.get("state");

  if (!shop || !code || !state) {
    return NextResponse.json({ error: "Paramètres OAuth manquants." }, { status: 400 });
  }

  // 1. HMAC de la requête (paramètres signés par Shopify) — anti-falsification.
  if (!verifyOAuthCallbackHmac(params)) {
    console.error("[shopify/callback] HMAC invalide", { shop });
    return NextResponse.json({ error: "Signature de la requête invalide." }, { status: 401 });
  }

  // 2. État anti-CSRF (émis par /api/shopify/install, à courte durée de vie).
  if (!(await verifyOAuthState(state, shop))) {
    console.error("[shopify/callback] state invalide ou expiré", { shop });
    return NextResponse.json({ error: "Session d'installation invalide ou expirée. Relancez l'installation." }, { status: 401 });
  }

  try {
    // 3. Échange du code contre un jeton d'accès (une seule fois — Shopify
    // invalide un code déjà utilisé).
    const { accessToken, scope } = await exchangeCodeForAccessToken(shop, code);
    const creds: ShopifyCredentials = { domain: shop, accessToken };

    // 4. Informations réelles de la boutique (jamais devinées).
    const shopInfo = await fetchShopInfo(creds);

    // 5. Provisioning partagé (Organization/Store/Integration/User/
    // Membership + webhooks obligatoires) — voir shopify-provision.ts. Un
    // Store existant conserve son historique, jamais recréé de zéro.
    const { userId, userEmail } = await provisionStoreFromShopifyAuth({
      shop,
      creds,
      scope,
      shopInfo,
      event: "integration.oauth_installed",
      message: `Boutique Shopify ${shop} installée via OAuth (scope: ${scope}).`,
    });

    // 6. Session ouverte pour le marchand (accès direct hors iframe, ex.
    // lien e-mail). À ce stade du parcours (redirection OAuth classique),
    // le navigateur est TOUJOURS au niveau supérieur (hors iframe) — cette
    // étape n'a fait que sortir de l'iframe pour obtenir le consentement.
    const token = await createSession({ userId, email: userEmail });
    await setSessionCookie(token);

    // 7. Redirection vers l'admin Shopify de la boutique : c'est Shopify qui
    // réintègre alors l'app dans l'iframe (App Bridge prend le relais via
    // /api/shopify/session-token-exchange, déclenché par la page racine —
    // voir src/app/page.tsx). Ne JAMAIS rediriger directement vers le
    // dashboard ici : ça laisserait l'app hors iframe après une installation
    // initiée depuis Shopify (comportement non conforme requis App Store).
    const apiKey = process.env.SHOPIFY_API_KEY; // non secret — identifiant public de l'app
    return NextResponse.redirect(`https://${shop}/admin/apps/${apiKey}`, { status: 302 });
  } catch (err) {
    console.error("[shopify/callback] échec de l'installation", { shop, error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json(
      { error: "L'installation a échoué. Aucune donnée n'a été enregistrée pour cette étape. Réessayez depuis Shopify." },
      { status: 502 },
    );
  }
}
