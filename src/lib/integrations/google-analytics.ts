import { SignJWT, jwtVerify } from "jose";

// ============================================================================
// GOOGLE ANALYTICS (GA4) — connecteur trafic/acquisition, 05/09/2026.
// OAuth 2.0 (Google), lecture seule : un seul scope, suffisant à la fois
// pour lister les propriétés accessibles (Admin API) et lire les rapports
// (Data API) — voir https://developers.google.com/analytics/devguides/config/admin/v1/rest/v1beta/accountSummaries/list
// (« Requires one of the following OAuth scopes: analytics.readonly,
// analytics.edit »). Jamais de portée d'écriture demandée : cette
// intégration ne modifie jamais rien dans Google Analytics.
// ============================================================================

const GA_OAUTH_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
const OAUTH_STATE_TTL_SECONDS = 600; // 10 minutes — même durée que l'état OAuth Shopify

export class GoogleAnalyticsApiError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

export interface GoogleAnalyticsCredentials {
  refreshToken: string;
  // null tant que le marchand n'a pas encore choisi sa propriété GA4 (étape
  // suivant le retour OAuth — voir /api/integrations/google-analytics/select-property).
  propertyId: string | null; // format "properties/123456789"
  propertyDisplayName: string | null;
}

function getAppCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new GoogleAnalyticsApiError(
      "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET manquants. Créez des identifiants OAuth (type « Application Web ») dans Google Cloud Console.",
    );
  }
  return { clientId, clientSecret };
}

function getAppUrl(): string {
  const url = process.env.APP_URL;
  if (!url) throw new GoogleAnalyticsApiError("APP_URL manquant : requis pour construire l'URL de redirection OAuth.");
  return url.replace(/\/$/, "");
}

function getRedirectUri(): string {
  return `${getAppUrl()}/api/integrations/google-analytics/callback`;
}

function getStateSecret(): Uint8Array {
  // Réutilise AUTH_SECRET, comme shopify-oauth.ts — jeton à courte durée de
  // vie, anti-CSRF de la poignée de main OAuth, jamais une variable dédiée
  // supplémentaire pour ce seul usage.
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new GoogleAnalyticsApiError("AUTH_SECRET manquant.");
  return new TextEncoder().encode(secret);
}

/** Jeton d'état signé, à courte durée de vie — protection CSRF du callback OAuth Google. */
export async function signGaOAuthState(storeId: string, userId: string): Promise<string> {
  return new SignJWT({ storeId, userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${OAUTH_STATE_TTL_SECONDS}s`)
    .sign(getStateSecret());
}

/** Retourne { storeId, userId } si l'état est valide, sinon null. */
export async function verifyGaOAuthState(token: string): Promise<{ storeId: string; userId: string } | null> {
  try {
    const { payload } = await jwtVerify(token, getStateSecret(), { algorithms: ["HS256"] });
    if (typeof payload.storeId !== "string" || typeof payload.userId !== "string") return null;
    return { storeId: payload.storeId, userId: payload.userId };
  } catch {
    return null;
  }
}

export function buildGaInstallUrl(state: string): string {
  const { clientId } = getAppCredentials();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getRedirectUri(),
    response_type: "code",
    scope: GA_OAUTH_SCOPE,
    // access_type=offline + prompt=consent : garantit un refresh_token à
    // CHAQUE autorisation, y compris une reconnexion après déconnexion —
    // Google ne renvoie sinon un refresh_token qu'à la toute première
    // autorisation d'un compte pour cette app.
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

interface GoogleTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

/** Échange le code d'autorisation contre un jeton d'accès + un refresh_token (une seule fois). */
export async function exchangeGaCodeForTokens(code: string): Promise<{ accessToken: string; refreshToken: string }> {
  const { clientId, clientSecret } = getAppCredentials();
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: getRedirectUri(),
      grant_type: "authorization_code",
    }),
  });
  const json = (await res.json().catch(() => ({}))) as GoogleTokenResponse;
  if (!res.ok || !json.access_token) {
    throw new GoogleAnalyticsApiError(json.error_description ?? "Échange du code OAuth refusé par Google.", res.status);
  }
  if (!json.refresh_token) {
    throw new GoogleAnalyticsApiError(
      "Google n'a renvoyé aucun refresh_token. Déconnectez cette intégration côté myaccount.google.com/permissions puis reconnectez-la.",
    );
  }
  return { accessToken: json.access_token, refreshToken: json.refresh_token };
}

/** Échange un refresh_token contre un nouveau jeton d'accès de courte durée (~1h). */
export async function refreshGaAccessToken(refreshToken: string): Promise<string> {
  const { clientId, clientSecret } = getAppCredentials();
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }),
  });
  const json = (await res.json().catch(() => ({}))) as GoogleTokenResponse;
  if (!res.ok || !json.access_token) {
    throw new GoogleAnalyticsApiError(json.error_description ?? "Rafraîchissement du jeton Google refusé.", res.status);
  }
  return json.access_token;
}

export interface GaProperty {
  propertyId: string; // "properties/123456789"
  displayName: string;
  accountDisplayName: string;
}

interface AccountSummariesResponse {
  accountSummaries?: Array<{
    displayName?: string;
    propertySummaries?: Array<{ property?: string; displayName?: string }>;
  }>;
}

/**
 * Liste les propriétés GA4 accessibles au compte Google connecté — permet
 * au marchand de choisir la sienne après l'autorisation OAuth (jamais
 * deviné : une propriété doit être choisie explicitement, voir
 * /api/integrations/google-analytics/select-property).
 */
export async function listGaProperties(accessToken: string): Promise<GaProperty[]> {
  const res = await fetch("https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new GoogleAnalyticsApiError(`Admin API Google Analytics a répondu ${res.status}.`, res.status);
  }
  const json = (await res.json()) as AccountSummariesResponse;
  const properties: GaProperty[] = [];
  for (const account of json.accountSummaries ?? []) {
    for (const prop of account.propertySummaries ?? []) {
      if (!prop.property) continue;
      properties.push({
        propertyId: prop.property,
        displayName: prop.displayName ?? prop.property,
        accountDisplayName: account.displayName ?? "Compte Google",
      });
    }
  }
  return properties;
}

interface RunReportResponse {
  dimensionHeaders?: Array<{ name: string }>;
  metricHeaders?: Array<{ name: string }>;
  rows?: Array<{ dimensionValues?: Array<{ value: string }>; metricValues?: Array<{ value: string }> }>;
}

async function runReport(
  accessToken: string,
  propertyId: string,
  body: { dimensions: string[]; metrics: string[]; startDate: string; endDate: string },
): Promise<RunReportResponse> {
  const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/${propertyId}:runReport`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      dateRanges: [{ startDate: body.startDate, endDate: body.endDate }],
      dimensions: body.dimensions.map((name) => ({ name })),
      metrics: body.metrics.map((name) => ({ name })),
      limit: 10000,
    }),
  });
  if (!res.ok) {
    const errJson = await res.json().catch(() => ({}));
    const message = (errJson as { error?: { message?: string } })?.error?.message;
    throw new GoogleAnalyticsApiError(message ?? `Data API Google Analytics a répondu ${res.status}.`, res.status);
  }
  return (await res.json()) as RunReportResponse;
}

export interface DailyAggregateRow {
  date: string; // "YYYYMMDD" (format GA4 natif — converti par l'appelant)
  sessions: number;
  activeUsers: number;
  newUsers: number;
  conversions: number;
  revenue: number;
}

/** Agrégat quotidien boutique entière : sessions, utilisateurs, conversions, revenu. */
export async function fetchDailyAggregate(accessToken: string, propertyId: string, startDate: string, endDate: string): Promise<DailyAggregateRow[]> {
  const report = await runReport(accessToken, propertyId, {
    dimensions: ["date"],
    metrics: ["sessions", "activeUsers", "newUsers", "conversions", "totalRevenue"],
    startDate,
    endDate,
  });
  return (report.rows ?? []).map((row) => ({
    date: row.dimensionValues?.[0]?.value ?? "",
    sessions: Number(row.metricValues?.[0]?.value ?? 0),
    activeUsers: Number(row.metricValues?.[1]?.value ?? 0),
    newUsers: Number(row.metricValues?.[2]?.value ?? 0),
    conversions: Number(row.metricValues?.[3]?.value ?? 0),
    revenue: Number(row.metricValues?.[4]?.value ?? 0),
  }));
}

export interface ChannelAggregateRow {
  date: string;
  sourceMedium: string;
  sessions: number;
  conversions: number;
  revenue: number;
}

/** Même fenêtre, ventilée par canal d'acquisition (sessionSourceMedium). */
export async function fetchChannelAggregate(accessToken: string, propertyId: string, startDate: string, endDate: string): Promise<ChannelAggregateRow[]> {
  const report = await runReport(accessToken, propertyId, {
    dimensions: ["date", "sessionSourceMedium"],
    metrics: ["sessions", "conversions", "totalRevenue"],
    startDate,
    endDate,
  });
  return (report.rows ?? []).map((row) => ({
    date: row.dimensionValues?.[0]?.value ?? "",
    sourceMedium: row.dimensionValues?.[1]?.value ?? "(non défini)",
    sessions: Number(row.metricValues?.[0]?.value ?? 0),
    conversions: Number(row.metricValues?.[1]?.value ?? 0),
    revenue: Number(row.metricValues?.[2]?.value ?? 0),
  }));
}

/** GA4 renvoie les dates au format "YYYYMMDD" — converti en Date UTC minuit. */
export function parseGaDate(yyyymmdd: string): Date {
  const year = Number(yyyymmdd.slice(0, 4));
  const month = Number(yyyymmdd.slice(4, 6));
  const day = Number(yyyymmdd.slice(6, 8));
  return new Date(Date.UTC(year, month - 1, day));
}
