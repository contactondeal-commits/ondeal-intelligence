// CONNECTEUR CJDROPSHIPPING (05/09/2026) — lecture SEULE du stock réel chez
// le fournisseur, via l'API officielle CJ (developers.cjdropshipping.com).
// Objectif : distinguer une vraie rupture (CJ aussi à 0) d'un simple défaut
// de synchronisation de l'app CJ vers Shopify (CJ a du stock, Shopify pas
// encore) — c'est exactement ce que `supplierStock`/`supplierMismatch`
// existent déjà pour représenter dans le schéma (voir Variant.supplierStock
// et recommendations.ts), jusqu'ici jamais alimenté en production faute de
// connecteur réel.
//
// ⚠️ CE CONNECTEUR N'ÉCRIT JAMAIS SUR SHOPIFY NI SUR CJ — lecture seule,
// utilisé uniquement pour informer un humain (voir executeReviewSupplier,
// api/actions/[id]/execute/route.ts). Toute correction de stock reste une
// décision manuelle du marchand.
//
// ⚠️ COMME POUR WOOCOMMERCE : CE CONNECTEUR N'A PU ÊTRE VÉRIFIÉ QU'AVEC UNE
// VRAIE CLÉ API CJ, PAS AVEC UNE BOUTIQUE DE DÉMO — construit à partir de la
// documentation officielle (developers.cjdropshipping.com /
// developers.cjdropshipping.cn) uniquement. La première utilisation réelle
// doit être suivie attentivement avant de faire confiance aux données
// renvoyées.

export interface CjCredentials {
  apiKey: string;
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

async function apiRequest<T>(creds: CjCredentials, path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${API_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url.toString(), { headers: { "CJ-Access-Token": creds.apiKey } });
      if (res.status === 429) {
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

/** Vérifie la clé API (utilisé lors de la connexion) — un appel léger, en lecture seule. */
export async function verifyCjCredentials(creds: CjCredentials): Promise<{ ok: true }> {
  // Aucun endpoint "whoami" documenté publiquement : la liste de produits,
  // page 1 / taille 1, sert de vérification en lecture seule la plus légère
  // disponible — une clé invalide échoue avec un statut/erreur explicite.
  await apiRequest<unknown>(creds, "/product/list", { pageNum: "1", pageSize: "1" });
  return { ok: true };
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
 */
export async function queryCjVariantStock(creds: CjCredentials, variantSku: string): Promise<CjVariantStock | null> {
  const data = await apiRequest<CjProductQueryResult>(creds, "/product/query", { variantSku });
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
