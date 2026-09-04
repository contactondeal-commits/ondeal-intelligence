import crypto from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { ShopifyApiError, type ShopifyCredentials } from "@/lib/integrations/shopify";

// ============================================================================
// COMMERCIALISATION — installation Shopify en un clic (OAuth), distincte du
// parcours "jeton manuel" existant (Paramètres > Intégrations, toujours
// disponible pour les boutiques pilotes). Toute valeur secrète provient
// exclusivement des variables d'environnement serveur — jamais saisie,
// jamais vue en clair par un tiers.
// ============================================================================

// Scopes alignés sur la configuration RÉELLEMENT déclarée pour cette app
// dans le Partner Dashboard Shopify (version active "ondeal-intelligence-2",
// vérifiée le 04/09/2026) — un écart entre le scope demandé ici et le scope
// déclaré côté Shopify peut faire échouer l'autorisation pour une app
// embarquée en installation gérée par Shopify. À ne modifier ICI qu'après
// avoir d'abord modifié la config Shopify elle-même (shopify.app.toml +
// `shopify app deploy`, hors périmètre de ce dépôt) — jamais l'inverse.
export const SHOPIFY_OAUTH_SCOPES = "read_products,write_products,read_inventory,write_inventory,read_orders";
const OAUTH_STATE_TTL_SECONDS = 600; // 10 minutes
const API_VERSION = "2025-01";

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

function getAppUrl(): string {
  const url = process.env.APP_URL;
  if (!url) throw new Error("APP_URL manquant : requis pour construire les URLs de redirection OAuth.");
  return url.replace(/\/$/, "");
}

function getStateSecret(): Uint8Array {
  // Réutilise AUTH_SECRET (déjà exigé, déjà un secret fort) plutôt que
  // d'introduire une variable d'environnement supplémentaire pour un jeton
  // à durée de vie très courte (anti-CSRF de la poignée de main OAuth).
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET manquant.");
  return new TextEncoder().encode(secret);
}

/**
 * Jeton d'état signé, à courte durée de vie — protection CSRF du callback
 * OAuth. `linkStoreId`, quand fourni, indique que cette installation doit
 * s'attacher à une boutique OnDeal déjà existante (marchand déjà connecté,
 * Paramètres > Intégrations) plutôt que de provisionner une nouvelle
 * Organization/Store — voir /api/shopify/install (vérifie l'accès AVANT de
 * signer) et /api/shopify/callback (revérifie l'accès APRÈS le retour).
 */
export async function signOAuthState(shop: string, linkStoreId?: string): Promise<string> {
  return new SignJWT({ shop, nonce: crypto.randomBytes(16).toString("hex"), ...(linkStoreId ? { linkStoreId } : {}) })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${OAUTH_STATE_TTL_SECONDS}s`)
    .sign(getStateSecret());
}

/** Retourne l'état décodé si valide pour `expectedShop`, sinon `null`. */
export async function verifyOAuthState(token: string, expectedShop: string): Promise<{ linkStoreId?: string } | null> {
  try {
    const { payload } = await jwtVerify(token, getStateSecret(), { algorithms: ["HS256"] });
    if (payload.shop !== expectedShop) return null;
    return { linkStoreId: typeof payload.linkStoreId === "string" ? payload.linkStoreId : undefined };
  } catch {
    return null;
  }
}

export function buildInstallUrl(shop: string, state: string): string {
  const { apiKey } = getAppCredentials();
  const redirectUri = `${getAppUrl()}/api/shopify/callback`;
  const params = new URLSearchParams({
    client_id: apiKey,
    scope: SHOPIFY_OAUTH_SCOPES,
    redirect_uri: redirectUri,
    state,
  });
  return `https://${shop}/admin/oauth/authorize?${params.toString()}`;
}

/**
 * Vérifie la signature HMAC des paramètres de requête OAuth (callback
 * d'installation) — distincte de la vérification HMAC des webhooks
 * (verifyShopifyWebhookHmac, sur le corps brut, pas la query string).
 * Référence Shopify : tri alphabétique des clés, jointes par "&", hex HMAC-SHA256.
 */
export function verifyOAuthCallbackHmac(searchParams: URLSearchParams): boolean {
  const { apiSecret } = getAppCredentials();
  const received = searchParams.get("hmac");
  if (!received) return false;
  const pairs: string[] = [];
  for (const [key, value] of searchParams.entries()) {
    if (key === "hmac" || key === "signature") continue;
    pairs.push(`${key}=${value}`);
  }
  pairs.sort();
  const message = pairs.join("&");
  const computed = crypto.createHmac("sha256", apiSecret).update(message).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(computed, "hex"), Buffer.from(received, "hex"));
  } catch {
    return false;
  }
}

/** Vérifie la signature HMAC d'un webhook Shopify (corps BRUT, header base64). */
export function verifyShopifyWebhookHmac(rawBody: string, hmacHeader: string | null): boolean {
  if (!hmacHeader) return false;
  const { apiSecret } = getAppCredentials();
  const computed = crypto.createHmac("sha256", apiSecret).update(rawBody, "utf8").digest("base64");
  try {
    return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(hmacHeader));
  } catch {
    return false;
  }
}

export interface OAuthTokenResult {
  accessToken: string;
  scope: string;
}

/** Échange le code d'autorisation contre un jeton d'accès (une seule fois, côté serveur). */
export async function exchangeCodeForAccessToken(shop: string, code: string): Promise<OAuthTokenResult> {
  const { apiKey, apiSecret } = getAppCredentials();
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_id: apiKey, client_secret: apiSecret, code }),
  });
  if (!res.ok) {
    throw new ShopifyApiError(`Échange du code OAuth refusé par Shopify (${res.status}).`, res.status);
  }
  const json = (await res.json()) as { access_token?: string; scope?: string };
  if (!json.access_token) throw new ShopifyApiError("Réponse OAuth Shopify sans access_token.");
  return { accessToken: json.access_token, scope: json.scope ?? "" };
}

export interface ShopInfo {
  name: string;
  email: string | null;
  myshopifyDomain: string;
}

/** Récupère les informations de la boutique juste après l'installation (jamais inventées). */
export async function fetchShopInfo(creds: ShopifyCredentials): Promise<ShopInfo> {
  const res = await fetch(`https://${creds.domain}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "content-type": "application/json", "X-Shopify-Access-Token": creds.accessToken },
    body: JSON.stringify({ query: `query { shop { name email myshopifyDomain } }` }),
  });
  if (!res.ok) throw new ShopifyApiError(`Shopify Admin API a répondu ${res.status}`, res.status);
  const json = (await res.json()) as {
    data?: { shop: { name: string; email: string | null; myshopifyDomain: string } };
    errors?: Array<{ message: string }>;
  };
  if (json.errors?.length) throw new ShopifyApiError(json.errors.map((e) => e.message).join("; "));
  if (!json.data) throw new ShopifyApiError("Réponse Shopify vide (shop info).");
  return json.data.shop;
}

// Topics des webhooks obligatoires (conformité App Store) + un webhook
// opérationnel (désinstallation) pour refléter immédiatement le statut côté
// app plutôt que d'attendre le shop/redact 48h plus tard.
const MANDATORY_WEBHOOK_TOPICS: Array<{ topic: string; path: string }> = [
  { topic: "CUSTOMERS_DATA_REQUEST", path: "/api/webhooks/shopify/customers-data-request" },
  { topic: "CUSTOMERS_REDACT", path: "/api/webhooks/shopify/customers-redact" },
  { topic: "SHOP_REDACT", path: "/api/webhooks/shopify/shop-redact" },
  { topic: "APP_UNINSTALLED", path: "/api/webhooks/shopify/app-uninstalled" },
  { topic: "APP_SUBSCRIPTIONS_UPDATE", path: "/api/webhooks/shopify/app-subscription-update" },
];

const WEBHOOK_SUBSCRIPTION_MUTATION = `
  mutation webhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
    webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
      webhookSubscription { id }
      userErrors { field message }
    }
  }
`;

/**
 * Enregistre les webhooks obligatoires auprès de Shopify après installation.
 * Best-effort par webhook : un échec isolé est loggé (console.error) et
 * n'interrompt pas l'installation — mais reste visible pour être corrigé,
 * jamais silencieusement ignoré.
 */
export async function registerMandatoryWebhooks(creds: ShopifyCredentials, storeId: string): Promise<void> {
  const appUrl = getAppUrl();
  for (const { topic, path } of MANDATORY_WEBHOOK_TOPICS) {
    try {
      const res = await fetch(`https://${creds.domain}/admin/api/${API_VERSION}/graphql.json`, {
        method: "POST",
        headers: { "content-type": "application/json", "X-Shopify-Access-Token": creds.accessToken },
        body: JSON.stringify({
          query: WEBHOOK_SUBSCRIPTION_MUTATION,
          variables: {
            topic,
            webhookSubscription: { callbackUrl: `${appUrl}${path}`, format: "JSON" },
          },
        }),
      });
      const json = (await res.json()) as {
        data?: { webhookSubscriptionCreate?: { userErrors?: Array<{ message: string }> } };
      };
      const userErrors = json.data?.webhookSubscriptionCreate?.userErrors;
      if (userErrors?.length) {
        console.error("[shopify-oauth] échec enregistrement webhook", { storeId, topic, userErrors });
      }
    } catch (err) {
      console.error("[shopify-oauth] erreur réseau enregistrement webhook", {
        storeId,
        topic,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
