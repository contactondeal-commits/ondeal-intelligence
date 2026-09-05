// CONNECTEUR CJDROPSHIPPING (05/09/2026) — lecture SEULE du stock réel chez
// le fournisseur, via l'API officielle CJ (developers.cjdropshipping.com).
// Objectif : distinguer une vraie rupture (CJ aussi à 0) d'un simple défaut
// de synchronisation de l'app CJ vers Shopify (CJ a du stock, Shopify pas
// encore) — c'est exactement ce que `supplierStock`/`supplierMismatch`
// existent déjà pour représenter dans le schéma (voir Variant.supplierStock
// et recommendations.ts), jusqu'ici jamais alimenté en production faute de
// connecteur réel.
//
// ⚠️ CE CONNECTEUR N'ÉCRIT JAMAIS SUR CJ — lecture seule côté CJ, à 100 %.
// Il n'écrit pas non plus sur Shopify DE SA PROPRE INITIATIVE : aucune tâche
// planifiée ne pousse un stock CJ vers Shopify sans action du marchand.
//
// CORRECTIF 05/09/2026 v2 — nuance ajoutée après un premier passage
// entièrement lecture seule : quand le marchand clique explicitement
// "Vérifier le fournisseur" (mission review_supplier, voir
// executeReviewSupplier/checkCjStock dans api/actions/[id]/execute/route.ts)
// et que CJ confirme un stock réel pour une variante affichée à 0 sur
// Shopify (vraie rupture), OnDeal corrige alors réellement ce stock sur
// Shopify — décision explicite de l'utilisateur, prise après lui avoir
// présenté l'alternative (correction planifiée sans clic, écartée). Le
// déclenchement reste toujours un clic humain ; seul l'EFFET de ce clic a
// changé (avant : rafraîchissait juste Variant.supplierStock affiché ;
// maintenant : corrige aussi Shopify si les conditions ci-dessus sont
// réunies). Jamais l'inverse (diminuer un stock existant sur la seule foi
// du chiffre fournisseur) — voir checkCjStock pour le détail des garde-fous.
//
// CORRECTIF PRODUCTION (05/09/2026) — la première connexion réelle a échoué
// ("Le fournisseur a refusé ces identifiants") : la version initiale de ce
// connecteur envoyait directement la clé API du tableau de bord CJ (`My CJ >
// Authorization > API`) comme en-tête `CJ-Access-Token`. Ce n'est PAS ce que
// l'API attend — confirmé par relecture de la doc officielle
// (developers.cjdropshipping.com/en/api/api2/api/auth.html) : cette clé
// (`apiKey`) doit d'abord être échangée contre un `accessToken` temporaire
// via `POST /authentication/getAccessToken`, et c'est CET accessToken (valide
// 15 jours, renouvelable via `refreshToken` valide 180 jours) qui sert
// d'en-tête `CJ-Access-Token` pour tous les appels suivants. La clé du
// tableau de bord elle-même ne change jamais et ne sert qu'à (re)dériver un
// accessToken — voir `cjdropshipping-token.ts` pour le rafraîchissement
// automatique côté appelant (mêmes principes que `shopify-token.ts`).
export interface CjCredentials {
  /** Clé générée dans My CJ > Authorization > API — ne change jamais, jamais utilisée directement comme en-tête d'appel. */
  apiKey: string;
  /** Jeton temporaire réellement utilisé pour l'en-tête CJ-Access-Token — absent avant la toute première connexion. */
  accessToken?: string;
  /** Epoch ms — horodatage d'expiration RÉEL renvoyé par CJ (accessTokenExpiryDate), jamais estimé. */
  accessTokenExpiresAt?: number;
  /** Permet de renouveler l'accessToken sans repasser par apiKey (mais apiKey reste le filet de sécurité — voir cjdropshipping-token.ts). */
  refreshToken?: string;
  /** Epoch ms — horodatage d'expiration RÉEL du refreshToken (180 jours documentés). */
  refreshTokenExpiresAt?: number;
}

export class CjApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
  }
}

const API_BASE = "https://developers.cjdropshipping.com/api2.0/v1";
const MAX_RETRIES = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface CjEnvelope<T> {
  code: number;
  result: boolean;
  message?: string;
  data: T;
  requestId?: string;
}

/** Un seul point d'appel HTTP, avec retry/backoff sur 429 — partagé par l'auth et les endpoints "métier". */
async function cjFetch<T>(url: string, init: RequestInit): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, init);
      if (res.status === 429) {
        // Rate limit documenté : 1 requête/seconde (QPS=1) sur l'auth comme
        // sur les endpoints produit — backoff avant de réessayer.
        await sleep(attempt * 1000);
        continue;
      }
      if (!res.ok) {
        throw new CjApiError(`L'API CJdropshipping a répondu ${res.status}`, res.status);
      }
      const envelope = (await res.json()) as CjEnvelope<T>;
      if (!envelope.result) {
        throw new CjApiError(envelope.message || "CJdropshipping a refusé la requête (result: false).", envelope.code);
      }
      return envelope.data;
    } catch (err) {
      lastError = err;
      if (err instanceof CjApiError && err.status && err.status !== 429) break; // erreur définitive (ex. clé invalide) — inutile de réessayer
      if (attempt < MAX_RETRIES) await sleep(attempt * 500);
    }
  }
  throw lastError instanceof Error ? lastError : new CjApiError("Échec de connexion à CJdropshipping.");
}

async function apiRequest<T>(accessToken: string, path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${API_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return cjFetch<T>(url.toString(), { headers: { "CJ-Access-Token": accessToken } });
}

export interface CjTokenBundle {
  accessToken: string;
  accessTokenExpiresAt: number;
  refreshToken: string;
  refreshTokenExpiresAt: number;
}

interface CjAuthResponseData {
  accessToken: string;
  accessTokenExpiryDate: string;
  refreshToken: string;
  refreshTokenExpiryDate: string;
}

function toBundle(data: CjAuthResponseData): CjTokenBundle {
  return {
    accessToken: data.accessToken,
    accessTokenExpiresAt: new Date(data.accessTokenExpiryDate).getTime(),
    refreshToken: data.refreshToken,
    refreshTokenExpiresAt: new Date(data.refreshTokenExpiryDate).getTime(),
  };
}

/**
 * Échange la clé API du tableau de bord CJ (My CJ > Authorization > API)
 * contre un accessToken temporaire — SEUL moyen documenté d'obtenir un jeton
 * utilisable comme en-tête CJ-Access-Token. À appeler lors de la connexion
 * initiale, et comme filet de sécurité si le renouvellement par
 * refreshToken échoue (voir cjdropshipping-token.ts) — la clé du tableau de
 * bord ne change jamais, contrairement à un jeton OAuth classique.
 */
export async function requestCjAccessToken(apiKey: string): Promise<CjTokenBundle> {
  const data = await cjFetch<CjAuthResponseData>(`${API_BASE}/authentication/getAccessToken`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ apiKey }),
  });
  return toBundle(data);
}

/** Renouvelle un accessToken proche de l'expiration (15 jours) via le refreshToken (180 jours), sans nouvelle demande de clé. */
export async function refreshCjAccessToken(refreshToken: string): Promise<CjTokenBundle> {
  const data = await cjFetch<CjAuthResponseData>(`${API_BASE}/authentication/refreshAccessToken`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });
  return toBundle(data);
}

/**
 * Vérifie la clé API (utilisé lors de la connexion) — échange réellement la
 * clé contre un accessToken puis confirme qu'il fonctionne avec un appel
 * léger en lecture seule. Retourne les credentials COMPLETS (avec le
 * nouveau bundle de jetons) à persister par l'appelant — jamais seulement
 * la clé d'origine.
 */
export async function verifyCjCredentials(creds: CjCredentials): Promise<CjCredentials> {
  const bundle = await requestCjAccessToken(creds.apiKey);
  // Aucun endpoint "whoami" documenté publiquement : la liste de produits,
  // page 1 / taille 1, sert de vérification en lecture seule la plus légère
  // disponible — un accessToken invalide échoue avec un statut/erreur explicite.
  await apiRequest<unknown>(bundle.accessToken, "/product/list", { pageNum: "1", pageSize: "1" });
  return {
    apiKey: creds.apiKey,
    accessToken: bundle.accessToken,
    accessTokenExpiresAt: bundle.accessTokenExpiresAt,
    refreshToken: bundle.refreshToken,
    refreshTokenExpiresAt: bundle.refreshTokenExpiresAt,
  };
}

interface CjWarehouseStock {
  countryCode: string;
  totalInventory: number;
  cjInventory: number;
  factoryInventory: number;
}

interface CjVariant {
  vid: string;
  variantSku: string;
  inventories?: CjWarehouseStock[];
}

interface CjProductQueryResult {
  pid: string;
  productNameEn: string;
  variants?: CjVariant[];
}

export interface CjVariantStock {
  variantSku: string;
  /** Stock réellement disponible en entrepôt CJ (prêt à expédier), toutes localisations confondues. */
  cjInventory: number;
  /** Stock usine (délai de fabrication supplémentaire) — distinct de cjInventory, jamais additionné silencieusement. */
  factoryInventory: number;
}

/**
 * Interroge le stock réel CJ pour UNE variante, par son SKU exact (celui
 * que l'app CJ écrit dans Shopify, ex. "CJXFZNZN00277-Blue LBS foreign
 * language"). Retourne `null` si CJ ne connaît pas ce SKU (jamais une
 * valeur inventée) — l'appelant décide alors quoi afficher.
 *
 * Nécessite un `accessToken` déjà valide dans `creds` — l'appelant doit
 * passer par `getFreshCjCredentials` (cjdropshipping-token.ts), jamais
 * décrypter des credentials CJ bruts directement.
 */
export async function queryCjVariantStock(creds: CjCredentials, variantSku: string): Promise<CjVariantStock | null> {
  if (!creds.accessToken) {
    throw new CjApiError("Jeton d'accès CJdropshipping manquant — reconnectez l'intégration (Paramètres > Intégrations).");
  }
  const data = await apiRequest<CjProductQueryResult>(creds.accessToken, "/product/query", { variantSku });
  const variant = data.variants?.find((v) => v.variantSku === variantSku);
  if (!variant || !variant.inventories || variant.inventories.length === 0) return null;

  // Sommé sur tous les pays/entrepôts renvoyés — CJ ventile par
  // countryCode, mais OnDeal n'a aujourd'hui aucune notion de marché/pays
  // de destination : le total représente "du stock existe quelque part chez
  // CJ", suffisant pour distinguer une vraie rupture d'un simple défaut de
  // synchro, sans prétendre à une répartition géographique précise.
  const cjInventory = variant.inventories.reduce((sum, w) => sum + (w.cjInventory ?? 0), 0);
  const factoryInventory = variant.inventories.reduce((sum, w) => sum + (w.factoryInventory ?? 0), 0);

  return { variantSku, cjInventory, factoryInventory };
}
