import { NextRequest, NextResponse } from "next/server";
import { createSession, setSessionCookie } from "@/lib/auth";
import { verifyIdToken, exchangeIdTokenForOfflineAccessToken } from "@/lib/integrations/shopify-embedded";
import { fetchShopInfo } from "@/lib/integrations/shopify-oauth";
import { provisionStoreFromShopifyAuth } from "@/lib/integrations/shopify-provision";
import type { ShopifyCredentials } from "@/lib/integrations/shopify";

// COMMERCIALISATION — app embarquée (App Bridge). Échange le jeton de
// session émis côté client par App Bridge (jamais un mot de passe, jamais
// saisi par qui que ce soit) contre un jeton d'accès Shopify, SANS jamais
// faire sortir le marchand de l'iframe admin (référence shopify.dev :
// "Exchange a session token for an access token"). Si la boutique n'a
// jamais autorisé l'app (ou jeton invalide), 401 — le client (voir
// src/components/shopify/embedded-bootstrap.tsx) bascule alors, en sortant
// de l'iframe, vers /api/shopify/install (flux OAuth classique).
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const idToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!idToken) {
    return NextResponse.json({ error: "Jeton de session manquant." }, { status: 401 });
  }

  const verified = await verifyIdToken(idToken);
  if (!verified) {
    return NextResponse.json(
      { error: "Jeton de session invalide ou expiré." },
      { status: 401, headers: { "X-Shopify-Retry-Invalid-Session-Request": "1" } },
    );
  }
  const { shop } = verified;

  try {
    const { accessToken, scope, refreshToken, expiresAt } = await exchangeIdTokenForOfflineAccessToken(shop, idToken);
    // refreshToken/expiresAt propagés (04/09/2026 — correctif) : sans eux,
    // ce jeton expirant (~1h) meurt silencieusement et ne peut plus jamais
    // être renouvelé automatiquement (voir shopify-token.ts).
    const creds: ShopifyCredentials = { domain: shop, accessToken, refreshToken, expiresAt };
    const shopInfo = await fetchShopInfo(creds);

    const { storeId, userId, userEmail } = await provisionStoreFromShopifyAuth({
      shop,
      creds,
      scope,
      shopInfo,
      event: "integration.embedded_session_exchange",
      message: `Session app embarquée établie pour ${shop} (scope: ${scope}).`,
    });

    // embeddedShop marqué dans la session : le middleware s'en sert pour
    // autoriser dynamiquement le framing (CSP frame-ancestors) sur ce
    // domaine précis lors des requêtes suivantes.
    const token = await createSession({ userId, email: userEmail, embeddedShop: shop });
    await setSessionCookie(token, { sameSite: "none" });

    return NextResponse.json({ ok: true, redirectUrl: `/dashboard?store=${storeId}` });
  } catch (err) {
    console.error("[shopify/session-token-exchange] échec", {
      shop,
      error: err instanceof Error ? err.message : String(err),
    });
    // Cas normal si la boutique n'a jamais autorisé l'app (Shopify refuse
    // alors le token exchange) — pas une panne : 401 générique, le client
    // bascule sur le flux d'autorisation classique.
    return NextResponse.json({ error: "Autorisation Shopify requise." }, { status: 401 });
  }
}
