import { jwtVerify } from "jose";
import { ShopifyApiError } from "@/lib/integrations/shopify";

// ============================================================================
// COMMERCIALISATION — App embarquée (App Bridge, jetons de session). Distinct
// de shopify-oauth.ts (flux OAuth classique redirect-based, conservé comme
// mécanisme d'autorisation initiale — voir set-embedded-app-authorization sur
// shopify.dev). Ici : vérification d'un ID token émis côté client par App
// Bridge, puis échange contre un jeton d'accès Shopify SANS jamais faire
// sortir le marchand de l'iframe admin. Toute valeur secrète provient
// exclusivement des variables d'environnement serveur.
// ============================================================================

const MYSHOPIFY_DOMAIN = /^[a-z0-9][a-z0-9-]{0,62}\.myshopify\.com$/i;

function getAppCredentials(): { apiKey: string; apiSecret: string } {
  const apiKey = process.env.SHOPIFY_API_KEY;
  const apiSecret = process.env.SHOPIFY_API_SECRET;
  if (!apiKey || !apiSecret || apiSecret === "changeme") {
    throw new Error(
      "SHOPIFY_API_KEY / SHOPIFY_API_SECRET manquants ou non configurés. " +
        "Créez l'app dans le Partner Dashboard Shopify puis renseignez ces variables.",
    );
  }
  return { apiKey, apiSecret };
}

export interface VerifiedIdToken {
  shop: string;
}

/**
 * Vérifie un ID token (jeton de session) émis par App Bridge côté client :
 * signature HS256 avec SHOPIFY_API_SECRET, audience = SHOPIFY_API_KEY, et
 * hôtes iss/dest identiques (anti-usurpation — référence shopify.dev,
 * implement-token-exchange). Retourne le domaine *.myshopify.com vérifié, ou
 * null si le jeton est invalide, expiré, ou mal formé. Ne fait JAMAIS
 * confiance à un domaine "shop" fourni par ailleurs sans cette vérification
 * cryptographique complète.
 */
export async function verifyIdToken(idToken: string): Promise<VerifiedIdToken | null> {
  try {
    const { apiKey, apiSecret } = getAppCredentials();
    const { payload } = await jwtVerify(idToken, new TextEncoder().encode(apiSecret), {
      algorithms: ["HS256"],
      audience: apiKey,
    });

    const iss = typeof payload.iss === "string" ? payload.iss : null;
    const dest = typeof payload.dest === "string" ? payload.dest : null;
    if (!iss || !dest) return null;

    const issHost = new URL(iss).hostname;
    const destHost = new URL(dest).hostname;
    if (issHost !== destHost) return null;
    if (!MYSHOPIFY_DOMAIN.test(destHost)) return null;

    return { shop: destHost.toLowerCase() };
  } catch {
    return null;
  }
}

export interface EmbeddedTokenExchangeResult {
  accessToken: string;
  scope: string;
  // Présents uniquement quand Shopify émet un jeton EXPIRANT (`expiring=1`,
  // requis pour une app embarquée récente — voir shopify.dev, "About
  // offline access tokens") : access token valable ~60 minutes, refresh
  // token valable 90 jours. Absents (jamais inventés) si Shopify répond
  // sans ces champs — le jeton est alors traité comme non-expirant.
  refreshToken?: string;
  expiresAt?: number;
}

interface RawTokenResponse {
  access_token?: string;
  scope?: string;
  expires_in?: number;
  refresh_token?: string;
}

function toExchangeResult(json: RawTokenResponse, context: string): EmbeddedTokenExchangeResult {
  if (!json.access_token) throw new ShopifyApiError(`Réponse Shopify sans access_token (${context}).`);
  return {
    accessToken: json.access_token,
    scope: json.scope ?? "",
    refreshToken: json.refresh_token,
    // expires_in est en secondes depuis l'émission — converti en horodatage
    // absolu RÉEL (jamais une durée relative stockée telle quelle, qui
    // dériverait par rapport au moment effectif de la requête).
    expiresAt: json.expires_in ? Date.now() + json.expires_in * 1000 : undefined,
  };
}

/**
 * Échange un ID token (App Bridge) contre un jeton d'accès OFFLINE, sans
 * jamais rediriger le marchand (référence shopify.dev, "Exchange a session
 * token for an access token" — grant_type token-exchange).
 */
export async function exchangeIdTokenForOfflineAccessToken(
  shop: string,
  idToken: string,
): Promise<EmbeddedTokenExchangeResult> {
  const { apiKey, apiSecret } = getAppCredentials();
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: apiKey,
      client_secret: apiSecret,
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      subject_token: idToken,
      subject_token_type: "urn:ietf:params:oauth:token-type:id_token",
      requested_token_type: "urn:shopify:params:oauth:token-type:offline-access-token",
      // N'a d'effet que pour un jeton offline nouvellement émis — requis par
      // Shopify pour les nouvelles installations. Conséquence assumée
      // (04/09/2026) : le jeton retourné n'est valable qu'~1h — voir
      // refreshOfflineAccessToken ci-dessous pour le renouvellement.
      expiring: "1",
    }),
  });
  if (!res.ok) {
    throw new ShopifyApiError(`Échange de jeton de session refusé par Shopify (${res.status}).`, res.status);
  }
  const json = (await res.json()) as RawTokenResponse;
  return toExchangeResult(json, "token exchange");
}

/**
 * Renouvelle un jeton d'accès EXPIRANT à partir de son refresh_token
 * (référence shopify.dev, "About offline access tokens" — grant_type
 * refresh_token). Chaque renouvellement retourne un NOUVEAU refresh_token
 * (rotation) qui remplace l'ancien — Shopify documente une fenêtre de 90
 * jours glissante à partir du dernier renouvellement effectif, jamais
 * calculée ici, toujours reçue telle quelle de Shopify.
 */
export async function refreshOfflineAccessToken(
  shop: string,
  refreshToken: string,
): Promise<EmbeddedTokenExchangeResult> {
  const { apiKey, apiSecret } = getAppCredentials();
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: apiKey,
      client_secret: apiSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) {
    // invalid_grant (refresh_token expiré après 90 jours d'inactivité, ou
    // révoqué — désinstallation, changement de mot de passe marchand) se
    // manifeste ici par un statut d'erreur — jamais distingué d'une autre
    // erreur réseau à ce niveau, l'appelant (shopify-token.ts) décide de la
    // suite (repasser l'Integration en ERROR, demander une reconnexion).
    throw new ShopifyApiError(`Renouvellement du jeton Shopify refusé (${res.status}).`, res.status);
  }
  const json = (await res.json()) as RawTokenResponse;
  return toExchangeResult(json, "refresh");
}
