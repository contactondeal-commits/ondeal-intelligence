import type { ShopifyProductNode, ShopifyVariantNode, ShopifyOrderNode, ShopifyOrderLineItem, FetchStats } from "@/lib/integrations/shopify";

// CONNECTEUR PRESTASHOP (04/09/2026) — même principe que woocommerce.ts :
// produit des objets à la forme ShopifyProductNode/ShopifyVariantNode/
// ShopifyOrderNode pour réutiliser tel quel le pipeline STORE → NORMALIZE →
// ANALYZE → INSIGHTS déjà vérifié en production. Voir le commentaire en
// tête de woocommerce.ts pour la justification complète de ce choix.
//
// ⚠️ CONSTRUIT UNIQUEMENT À PARTIR DE LA DOCUMENTATION OFFICIELLE
// (devdocs.prestashop-project.org) — AUCUNE VÉRIFICATION CONTRE UNE VRAIE
// BOUTIQUE PRESTASHOP N'A ÉTÉ POSSIBLE. Trois zones d'incertitude
// documentées précisément où elles apparaissent ci-dessous : (1) la forme
// exacte des champs multilingues (name/description), traitée de façon
// défensive (chaîne simple OU tableau {id,value}) ; (2) la détection des
// commandes "annulées"/"remboursées", qui repose sur le LIBELLÉ de l'état de
// commande (order_states) plutôt que sur un identifiant fixe — un état
// personnalisé au libellé inhabituel ne sera pas détecté (traité par défaut
// comme non-annulé, jamais l'inverse : on ne veut jamais exclure une vente
// réelle par excès de prudence) ; (3) le coût d'achat (wholesale_price)
// n'existe qu'au niveau PRODUIT dans ce connecteur, jamais par combinaison
// (PrestaShop le permet en théorie, non lu ici). La première connexion
// réelle doit être vérifiée attentivement (audit-log, premier
// SYNC.COMPLETED, quelques produits comparés à la main) avant toute confiance.

export interface PrestaShopCredentials {
  /** URL racine de la boutique, SANS /api — ex. https://ma-boutique.fr */
  siteUrl: string;
  /** Clé Webservice (Paramètres avancés > Webservice, dans l'admin PrestaShop). */
  apiKey: string;
}

export class PrestaShopApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
  }
}

const PER_PAGE = 100;
const MAX_RETRIES = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function authHeader(creds: PrestaShopCredentials): string {
  // HTTP Basic Auth — la clé Webservice comme identifiant, mot de passe
  // vide (documentation officielle PrestaShop : "the key is the username,
  // the password is left empty. The trailing colon matters").
  const token = Buffer.from(`${creds.apiKey}:`).toString("base64");
  return `Basic ${token}`;
}

async function apiRequest<T>(creds: PrestaShopCredentials, path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${creds.siteUrl.replace(/\/$/, "")}/api${path}`);
  url.searchParams.set("output_format", "JSON");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url.toString(), { headers: { authorization: authHeader(creds) } });
      if (res.status === 429) {
        await sleep(attempt * 1000);
        continue;
      }
      if (!res.ok) {
        throw new PrestaShopApiError(`PrestaShop Webservice a répondu ${res.status}`, res.status);
      }
      return (await res.json()) as T;
    } catch (err) {
      lastError = err;
      if (attempt < MAX_RETRIES) await sleep(attempt * 500);
    }
  }
  throw lastError instanceof Error ? lastError : new PrestaShopApiError("Échec de connexion à PrestaShop");
}

/**
 * Champ multilingue PrestaShop : selon le contexte (comptes anciens, config,
 * nombre de langues), peut revenir comme chaîne simple OU comme tableau
 * `[{id/attrs.id, value}]` — jamais supposé, les deux formes sont acceptées.
 * Prend la première valeur non vide disponible.
 */
function extractLocalizedValue(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (typeof entry === "string" && entry) return entry;
      if (entry && typeof entry === "object" && "value" in entry) {
        const v = (entry as { value?: unknown }).value;
        if (typeof v === "string" && v) return v;
      }
    }
  }
  return "";
}

function toNumberOrNull(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "string" ? Number(raw) : raw;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/** Vérifie les identifiants (utilisé lors de la connexion) — un appel léger, en lecture seule. */
export async function verifyPrestaShopCredentials(creds: PrestaShopCredentials): Promise<{ shopName: string }> {
  await apiRequest<unknown>(creds, "/shops", { display: "[id]", limit: "1" });
  return { shopName: creds.siteUrl };
}

// --- PRODUITS + COMBINAISONS + STOCK ------------------------------------

interface RawPsProduct {
  id: number;
  link_rewrite: unknown; // multilingue
  name: unknown; // multilingue
  active: string; // "0" | "1"
  reference: string;
  price: string; // HT, hors impact des combinaisons
  wholesale_price: string; // coût d'achat déclaré — jamais deviné, absent = null
  id_category_default: string;
  date_add: string;
  associations?: { combinations?: Array<{ id: string }>; images?: Array<{ id: string }> };
}

interface RawPsCombination {
  id: number;
  id_product: number;
  reference: string;
  price: string; // IMPACT (delta, peut être négatif) — pas un prix absolu, voir toVariantNodeFromCombination
  associations?: { product_option_values?: Array<{ id: string }> };
}

interface RawPsStockAvailable {
  id_product: number;
  id_product_attribute: number; // 0 = stock du produit lui-même (sans combinaison)
  quantity: string;
}

interface RawPsProductOptionValue {
  id: number;
  name: unknown; // multilingue — ex. "Rouge", "M"
}

interface RawPsCategory {
  id: number;
  name: unknown; // multilingue
}

/** "0"/"1" PrestaShop `active` → vocabulaire interne. PrestaShop n'a pas de
 * notion "brouillon" distincte d'"inactif" au niveau produit ; un produit
 * désactivé est traité comme "draft" (jamais "archived", qui n'a pas
 * d'équivalent direct côté PrestaShop cœur). */
function mapStatus(active: string): string {
  return active === "1" ? "active" : "draft";
}

async function fetchAllPaginated<T>(creds: PrestaShopCredentials, resource: string, display: string, stats?: FetchStats): Promise<T[]> {
  const all: T[] = [];
  let offset = 0;
  for (;;) {
    const data = await apiRequest<{ [key: string]: T[] }>(creds, `/${resource}`, {
      display,
      limit: `${offset},${PER_PAGE}`,
    });
    if (stats) stats.pages += 1;
    const items = data[resource] ?? [];
    all.push(...items);
    if (items.length < PER_PAGE) break;
    offset += PER_PAGE;
  }
  return all;
}

export async function fetchAllProducts(
  creds: PrestaShopCredentials,
  onPage?: (nodes: ShopifyProductNode[]) => void,
  stats?: FetchStats,
): Promise<ShopifyProductNode[]> {
  // Trois collections récupérées intégralement puis jointes en mémoire —
  // évite un aller-retour par produit (N+1) pour le stock et les
  // combinaisons, seul moyen réaliste de synchroniser un catalogue de
  // taille significative dans le temps d'une fonction serverless.
  const [products, combinations, stockAvailables, categories, optionValues] = await Promise.all([
    fetchAllPaginated<RawPsProduct>(
      creds,
      "products",
      "[id,link_rewrite,name,active,reference,price,wholesale_price,id_category_default,date_add,associations]",
      stats,
    ),
    fetchAllPaginated<RawPsCombination>(creds, "combinations", "[id,id_product,reference,price,associations]", stats),
    fetchAllPaginated<RawPsStockAvailable>(creds, "stock_availables", "[id_product,id_product_attribute,quantity]", stats),
    fetchAllPaginated<RawPsCategory>(creds, "categories", "[id,name]", stats).catch(() => [] as RawPsCategory[]),
    fetchAllPaginated<RawPsProductOptionValue>(creds, "product_option_values", "[id,name]", stats).catch(
      () => [] as RawPsProductOptionValue[],
    ),
  ]);

  const stockByKey = new Map<string, number>();
  for (const s of stockAvailables) {
    stockByKey.set(`${s.id_product}:${s.id_product_attribute}`, toNumberOrNull(s.quantity) ?? 0);
  }
  const categoryNameById = new Map<number, string>();
  for (const c of categories) categoryNameById.set(c.id, extractLocalizedValue(c.name));
  const optionValueNameById = new Map<number, string>();
  for (const ov of optionValues) optionValueNameById.set(ov.id, extractLocalizedValue(ov.name));
  const combinationsByProduct = new Map<number, RawPsCombination[]>();
  for (const c of combinations) {
    const list = combinationsByProduct.get(c.id_product) ?? [];
    list.push(c);
    combinationsByProduct.set(c.id_product, list);
  }

  const nodes: ShopifyProductNode[] = products.map((p) => {
    const basePrice = toNumberOrNull(p.price) ?? 0;
    const unitCost = toNumberOrNull(p.wholesale_price);
    const productCombinations = combinationsByProduct.get(p.id) ?? [];

    let variants: ShopifyVariantNode[];
    if (productCombinations.length > 0) {
      variants = productCombinations.map((c) => {
        // `price` sur une combinaison est un IMPACT (delta signé), jamais un
        // prix absolu — le prix final de la combinaison est price produit +
        // impact combinaison (les deux hors taxes). Documentation officielle :
        // champ "unit_price_impact" / "price" de type isNegativePrice.
        const impact = toNumberOrNull(c.price) ?? 0;
        const finalPrice = basePrice + impact;
        const optionIds = (c.associations?.product_option_values ?? []).map((v) => Number(v.id));
        const title = optionIds.length > 0 ? optionIds.map((id) => optionValueNameById.get(id) ?? `#${id}`).join(" / ") : "Défaut";
        return {
          id: String(c.id),
          title,
          sku: c.reference || null,
          price: finalPrice.toFixed(2),
          compareAtPrice: null, // PrestaShop n'a pas de "prix barré" par combinaison distinct du prix produit
          inventoryQuantity: stockByKey.get(`${p.id}:${c.id}`) ?? null,
          // Coût d'achat non lu par combinaison (voir en-tête de fichier) —
          // le coût du produit parent est appliqué à toutes ses combinaisons
          // ci-dessous via costForAllVariants, cohérent avec le principe
          // "jamais 0 par défaut, jamais deviné" : mieux vaut le même coût
          // connu pour toutes les variantes qu'un coût à 0 pour certaines.
          inventoryItem: unitCost !== null ? { tracked: true, unitCost: { amount: unitCost.toFixed(2), currencyCode: "" } } : null,
        };
      });
    } else {
      // Produit sans combinaison : pseudo-variant portant l'id du produit
      // lui-même, même convention que pour Shopify/WooCommerce.
      variants = [
        {
          id: String(p.id),
          title: "Défaut",
          sku: p.reference || null,
          price: basePrice.toFixed(2),
          compareAtPrice: null,
          inventoryQuantity: stockByKey.get(`${p.id}:0`) ?? null,
          inventoryItem: unitCost !== null ? { tracked: true, unitCost: { amount: unitCost.toFixed(2), currencyCode: "" } } : null,
        },
      ];
    }

    return {
      id: String(p.id),
      handle: extractLocalizedValue(p.link_rewrite) || `produit-${p.id}`,
      title: extractLocalizedValue(p.name) || "(sans titre)",
      status: mapStatus(p.active),
      productType: categoryNameById.get(Number(p.id_category_default)) ?? null,
      vendor: null, // pas de notion de fournisseur/marque exploitable ici sans requête supplémentaire par produit
      createdAt: p.date_add,
      featuredImage: null, // nécessiterait une requête /images par produit — non chargé en synchro catalogue (coûteux, non critique pour l'intelligence)
      variants: { nodes: variants },
    };
  });

  onPage?.(nodes);
  return nodes;
}

// --- COMMANDES ------------------------------------------------------------

interface RawPsOrderDetail {
  id: number;
  product_id: string;
  product_attribute_id: string; // "0" si pas de combinaison
  product_quantity: string;
  product_price: string; // prix unitaire HT AVANT remise de ligne
  total_price_tax_excl: string; // total de ligne HT APRÈS remise
}

interface RawPsOrder {
  id: number;
  reference: string;
  id_currency: string;
  current_state: string;
  date_add: string;
  date_upd: string;
  total_paid: string;
  total_paid_real: string; // montant réellement encaissé — total_paid - total_paid_real ≈ remboursé
  associations?: { order_rows?: RawPsOrderDetail[] };
}

interface RawPsOrderState {
  id: number;
  name: unknown; // multilingue
}

interface RawPsCurrency {
  id: number;
  iso_code: string;
}

/** États dont le LIBELLÉ indique une annulation/un remboursement (FR + EN —
 * PrestaShop peut être installé dans d'autres langues ; un libellé non
 * reconnu n'est PAS traité comme annulé, voir avertissement en tête de fichier). */
const CANCELLED_STATE_KEYWORDS = ["annul", "cancel"];

async function fetchOrderStateNamesById(creds: PrestaShopCredentials, stats?: FetchStats): Promise<Map<number, string>> {
  const states = await fetchAllPaginated<RawPsOrderState>(creds, "order_states", "[id,name]", stats).catch(() => [] as RawPsOrderState[]);
  const map = new Map<number, string>();
  for (const s of states) map.set(s.id, extractLocalizedValue(s.name).toLowerCase());
  return map;
}

export async function fetchRecentOrders(creds: PrestaShopCredentials, days: number, stats?: FetchStats): Promise<ShopifyOrderNode[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const sinceStr = since.toISOString().slice(0, 10); // PrestaShop filtre par date (YYYY-MM-DD)

  const [orders, stateNamesById, currencies] = await Promise.all([
    fetchAllPaginated<RawPsOrder>(
      creds,
      "orders",
      "[id,reference,id_currency,current_state,date_add,date_upd,total_paid,total_paid_real,associations]",
      stats,
    ),
    fetchOrderStateNamesById(creds, stats),
    fetchAllPaginated<RawPsCurrency>(creds, "currencies", "[id,iso_code]", stats).catch(() => [] as RawPsCurrency[]),
  ]);

  const currencyById = new Map<number, string>();
  for (const c of currencies) currencyById.set(c.id, c.iso_code);

  const recent = orders.filter((o) => o.date_add >= sinceStr);

  return recent.map((o) => {
    const stateName = stateNamesById.get(Number(o.current_state)) ?? "";
    const isCancelled = CANCELLED_STATE_KEYWORDS.some((kw) => stateName.includes(kw));
    const totalPaid = toNumberOrNull(o.total_paid);
    const totalPaidReal = toNumberOrNull(o.total_paid_real);
    const totalRefunded = totalPaid !== null && totalPaidReal !== null && totalPaid > totalPaidReal ? totalPaid - totalPaidReal : null;

    const lines: ShopifyOrderLineItem[] = (o.associations?.order_rows ?? []).map((row) => {
      const qty = toNumberOrNull(row.product_quantity) ?? 0;
      const unitPrice = toNumberOrNull(row.product_price) ?? 0;
      const attributeId = row.product_attribute_id && row.product_attribute_id !== "0" ? row.product_attribute_id : row.product_id;
      return {
        id: String(row.id),
        quantity: qty,
        currentQuantity: qty, // pas de "retrait d'article" distinct côté PrestaShop cœur — voir woocommerce.ts, même raisonnement
        originalTotal: unitPrice * qty,
        discountedTotal: toNumberOrNull(row.total_price_tax_excl) ?? unitPrice * qty,
        productId: String(row.product_id),
        variantId: String(attributeId),
      };
    });

    return {
      id: String(o.id),
      name: o.reference ? `#${o.reference}` : `#${o.id}`,
      createdAt: o.date_add,
      cancelledAt: isCancelled ? o.date_upd : null,
      financialStatus: stateName || null,
      currencyCode: currencyById.get(Number(o.id_currency)) ?? null,
      totalPrice: totalPaid,
      totalRefunded,
      lineItems: lines,
    };
  });
}
