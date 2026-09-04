import type { ShopifyProductNode, ShopifyVariantNode, ShopifyOrderNode, ShopifyOrderLineItem, FetchStats } from "@/lib/integrations/shopify";

// CONNECTEUR WOOCOMMERCE (04/09/2026) — même rôle que shopify.ts, mais pour
// un catalogue WooCommerce (REST API v3, WordPress). Les fonctions
// produisent des objets dont la FORME est identique à ShopifyProductNode/
// ShopifyVariantNode/ShopifyOrderNode (types importés depuis shopify.ts) —
// PAS parce que WooCommerce a un rapport avec Shopify, mais parce que
// storeProducts/storeOrders/normalizeVariant (sync/shopifyStore.ts,
// validation/normalize.ts) et tout le pipeline ANALYZE → INSIGHTS en aval
// sont déjà écrits contre cette forme d'objet et fonctionnent en production
// pour de vrai. Réutiliser la même forme = zéro changement, zéro risque
// sur ce qui tourne déjà, pour n'importe quel connecteur catalogue futur.
// Décision documentée ici plutôt qu'un renommage global du schéma (qui
// toucherait des dizaines de fichiers déjà vérifiés en production sans
// pouvoir être re-testés en direct pour ce connecteur — voir plus bas).
//
// ⚠️ CONTRAIREMENT AU CORRECTIF SHOPIFY DE CE JOUR, CE CONNECTEUR N'A PU
// ÊTRE VÉRIFIÉ CONTRE AUCUNE VRAIE BOUTIQUE WOOCOMMERCE — construit à partir
// de la documentation officielle uniquement (developer.woocommerce.com).
// Une première connexion réelle doit être suivie attentivement (audit-log,
// premier SYNC.COMPLETED) avant de faire confiance aux données importées.

export interface WooCommerceCredentials {
  /** URL racine du site, SANS /wp-json — ex. https://ma-boutique.com */
  siteUrl: string;
  consumerKey: string;
  consumerSecret: string;
}

export class WooCommerceApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
  }
}

const API_BASE = "/wp-json/wc/v3";
const PER_PAGE = 100; // maximum autorisé par l'API WooCommerce
const MAX_RETRIES = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function authHeader(creds: WooCommerceCredentials): string {
  // HTTP Basic Auth — seule méthode utilisée ici (le site doit être en
  // HTTPS ; WooCommerce impose de toute façon HTTPS pour Basic Auth sur les
  // identifiants consumer key/secret hors contexte OAuth1.0a "one-legged").
  const token = Buffer.from(`${creds.consumerKey}:${creds.consumerSecret}`).toString("base64");
  return `Basic ${token}`;
}

async function apiRequest<T>(creds: WooCommerceCredentials, path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${creds.siteUrl.replace(/\/$/, "")}${API_BASE}${path}`);
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
        throw new WooCommerceApiError(`WooCommerce REST API a répondu ${res.status}`, res.status);
      }
      return (await res.json()) as T;
    } catch (err) {
      lastError = err;
      if (attempt < MAX_RETRIES) await sleep(attempt * 500);
    }
  }
  throw lastError instanceof Error ? lastError : new WooCommerceApiError("Échec de connexion à WooCommerce");
}

/** Vérifie les identifiants (utilisé lors de la connexion) — un appel léger, en lecture seule. */
export async function verifyWooCommerceCredentials(creds: WooCommerceCredentials): Promise<{ shopName: string }> {
  const data = await apiRequest<{ environment?: { site_url?: string } }>(creds, "/system_status");
  return { shopName: data.environment?.site_url ?? creds.siteUrl };
}

// --- PRODUITS ---------------------------------------------------------

interface RawWooProduct {
  id: number;
  name: string;
  slug: string;
  status: string; // "publish" | "draft" | "pending" | "private"
  type: string; // "simple" | "variable" | "grouped" | "external"
  categories?: Array<{ id: number; name: string }>;
  date_created: string;
  images?: Array<{ src: string }>;
  sku: string;
  price: string;
  regular_price: string;
  sale_price: string;
  on_sale: boolean;
  manage_stock: boolean;
  stock_quantity: number | null;
  variations?: number[];
}

interface RawWooVariation {
  id: number;
  sku: string;
  price: string;
  regular_price: string;
  sale_price: string;
  on_sale: boolean;
  manage_stock: boolean;
  stock_quantity: number | null;
  attributes?: Array<{ name: string; option: string }>;
}

/**
 * Statut WooCommerce ("publish"/"draft"/"pending"/"private") → vocabulaire
 * interne ("active"/"draft"/"archived", le même que storeProducts attend de
 * Shopify — voir p.status.toLowerCase() dans shopifyStore.ts). WooCommerce
 * n'a pas de notion d'"archivé" propre ; "private" (visible seulement des
 * admins) est le plus proche équivalent — mapping documenté, pas deviné.
 */
function mapStatus(raw: string): string {
  if (raw === "publish") return "active";
  if (raw === "private") return "archived";
  return "draft"; // draft, pending, ou tout statut inconnu
}

function variantTitleFromAttributes(attrs: RawWooVariation["attributes"]): string {
  if (!attrs || attrs.length === 0) return "Défaut";
  return attrs.map((a) => a.option).join(" / ");
}

function toVariantNode(v: {
  id: number;
  sku: string;
  price: string;
  regular_price: string;
  sale_price: string;
  on_sale: boolean;
  manage_stock: boolean;
  stock_quantity: number | null;
  title: string;
}): ShopifyVariantNode {
  // "Prix barré" WooCommerce : quand on_sale, le prix affiché (`price`) est
  // le prix promo, et `regular_price` est le prix "avant" — l'équivalent
  // exact de compareAtPrice Shopify. Hors promotion, pas de prix barré.
  const price = v.price || v.regular_price || "0";
  const compareAtPrice = v.on_sale && v.regular_price && v.regular_price !== price ? v.regular_price : null;
  return {
    id: String(v.id),
    title: v.title,
    sku: v.sku || null,
    price,
    compareAtPrice,
    // manage_stock=false → WooCommerce ne suit pas ce stock (vente illimitée
    // ou géré ailleurs) : traité comme "donnée non disponible", jamais 0.
    inventoryQuantity: v.manage_stock ? v.stock_quantity : null,
    // WooCommerce cœur n'expose AUCUN champ "coût d'achat" natif (contrairement
    // à Shopify inventoryItem.unitCost) — seul un plugin tiers (ex. Cost of
    // Goods) l'ajouterait, non standardisé, donc jamais lu ici. Reste null,
    // exactement comme un variant Shopify sans coût renseigné : le moteur de
    // marge retombe déjà proprement sur les CostAssumption saisies dans OnDeal.
    inventoryItem: null,
  };
}

export async function fetchAllProducts(
  creds: WooCommerceCredentials,
  onPage?: (nodes: ShopifyProductNode[]) => void,
  stats?: FetchStats,
): Promise<ShopifyProductNode[]> {
  const all: ShopifyProductNode[] = [];
  let page = 1;

  for (;;) {
    const products = await apiRequest<RawWooProduct[]>(creds, "/products", {
      per_page: String(PER_PAGE),
      page: String(page),
      orderby: "id",
      order: "asc",
    });
    if (stats) stats.pages += 1;
    if (products.length === 0) break;

    const pageNodes: ShopifyProductNode[] = [];
    for (const p of products) {
      let variants: ShopifyVariantNode[];
      if (p.type === "variable" && p.variations && p.variations.length > 0) {
        // Produit à variations : une requête paginée sur /products/{id}/variations
        // (jusqu'à 100 par page également — un produit avec >100 variations
        // nécessiterait une page suivante, comme pour les produits eux-mêmes).
        variants = [];
        let vPage = 1;
        for (;;) {
          const raw = await apiRequest<RawWooVariation[]>(creds, `/products/${p.id}/variations`, {
            per_page: String(PER_PAGE),
            page: String(vPage),
          });
          if (stats) stats.continuationRequests += 1;
          if (raw.length === 0) break;
          variants.push(...raw.map((v) => toVariantNode({ ...v, title: variantTitleFromAttributes(v.attributes) })));
          if (raw.length < PER_PAGE) break;
          vPage += 1;
        }
      } else {
        // Produit "simple" (sans variation) : traité comme un unique
        // pseudo-variant portant l'id du PRODUIT lui-même — même convention
        // que Shopify (chaque produit a toujours ≥1 variante par défaut).
        variants = [
          toVariantNode({
            id: p.id,
            sku: p.sku,
            price: p.price,
            regular_price: p.regular_price,
            sale_price: p.sale_price,
            on_sale: p.on_sale,
            manage_stock: p.manage_stock,
            stock_quantity: p.stock_quantity,
            title: "Défaut",
          }),
        ];
      }

      pageNodes.push({
        id: String(p.id),
        handle: p.slug,
        title: p.name || "(sans titre)",
        status: mapStatus(p.status),
        // WooCommerce n'a pas de champ "type de produit" marchand équivalent
        // à Shopify product_type (son champ `type` est structurel : simple/
        // variable/groupé) — la première catégorie assignée est la meilleure
        // approximation disponible, documentée comme telle.
        productType: p.categories?.[0]?.name ?? null,
        // Pas de notion de "fournisseur/marque" dans WooCommerce cœur (plugin
        // marketplace requis, non standard) — toujours null, jamais deviné.
        vendor: null,
        createdAt: p.date_created,
        featuredImage: p.images?.[0]?.src ? { url: p.images[0].src } : null,
        variants: { nodes: variants },
      });
    }

    all.push(...pageNodes);
    onPage?.(pageNodes);
    if (products.length < PER_PAGE) break;
    page += 1;
  }

  return all;
}

// --- COMMANDES ----------------------------------------------------------

interface RawWooLineItem {
  id: number;
  product_id: number;
  variation_id: number; // 0 si le produit n'a pas de variation
  quantity: number;
  subtotal: string; // avant remise
  total: string; // après remise
}

interface RawWooRefund {
  id: number;
  total: string; // négatif ou positif selon version — toujours ramené à sa valeur absolue
}

interface RawWooOrder {
  id: number;
  status: string; // pending|processing|on-hold|completed|cancelled|refunded|failed|trash
  date_created: string;
  date_modified: string;
  currency: string;
  total: string;
  line_items: RawWooLineItem[];
  refunds?: RawWooRefund[];
}

function toOrderLineItem(li: RawWooLineItem): ShopifyOrderLineItem {
  // Ligne sur une variation → productId = produit parent, variantId =
  // variation ; ligne sur un produit simple (variation_id=0) → variantId =
  // l'id du produit lui-même, cohérent avec le pseudo-variant créé dans
  // fetchAllProducts pour ce même cas.
  const variantId = li.variation_id > 0 ? String(li.variation_id) : String(li.product_id);
  return {
    id: String(li.id),
    quantity: li.quantity,
    // WooCommerce ne distingue pas "quantité initiale" vs "quantité restante
    // après retrait d'article" comme Shopify currentQuantity (un retrait
    // partiel d'article n'existe pas côté WooCommerce cœur — un remboursement
    // se fait au niveau de la commande via /refunds) : les deux valent la
    // même quantité ici, ce n'est jamais une approximation dégradée.
    currentQuantity: li.quantity,
    originalTotal: Number(li.subtotal) || 0,
    discountedTotal: Number(li.total) || 0,
    productId: String(li.product_id),
    variantId,
  };
}

/**
 * Statuts considérés "annulés" (exclus des ventes, comme les commandes
 * cancelledAt côté Shopify) — WooCommerce n'a pas de type énuméré strict,
 * ce sont des chaînes de statut standard du cœur, jamais des libellés
 * personnalisés (contrairement à PrestaShop, voir prestashop.ts).
 */
const CANCELLED_STATUSES = new Set(["cancelled", "failed", "trash"]);

function toOrderNode(o: RawWooOrder): ShopifyOrderNode {
  const totalRefunded = (o.refunds ?? []).reduce((sum, r) => sum + Math.abs(Number(r.total) || 0), 0);
  return {
    id: String(o.id),
    name: `#${o.id}`,
    createdAt: o.date_created,
    cancelledAt: CANCELLED_STATUSES.has(o.status) ? o.date_modified : null,
    financialStatus: o.status,
    currencyCode: o.currency || null,
    totalPrice: Number(o.total) || null,
    totalRefunded: totalRefunded > 0 ? totalRefunded : null,
    lineItems: o.line_items.map(toOrderLineItem),
  };
}

export async function fetchRecentOrders(creds: WooCommerceCredentials, days: number, stats?: FetchStats): Promise<ShopifyOrderNode[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const all: ShopifyOrderNode[] = [];
  let page = 1;

  for (;;) {
    const orders = await apiRequest<RawWooOrder[]>(creds, "/orders", {
      per_page: String(PER_PAGE),
      page: String(page),
      after: since,
      orderby: "date",
      order: "asc",
    });
    if (stats) stats.pages += 1;
    if (orders.length === 0) break;
    all.push(...orders.map(toOrderNode));
    if (orders.length < PER_PAGE) break;
    page += 1;
  }

  return all;
}
