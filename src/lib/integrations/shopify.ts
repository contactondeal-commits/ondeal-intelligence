// PHASE 17 — Connecteur Shopify (Admin GraphQL API). Indépendant des autres
// connecteurs : si les credentials sont absents/invalides, chaque fonction
// retourne une erreur typée plutôt que de faire planter l'application, et
// l'appelant (sync/pipeline.ts) dégrade proprement vers "Non connecté".

export interface ShopifyCredentials {
  domain: string; // ex: my-store.myshopify.com
  accessToken: string;
}

export class ShopifyApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
  }
}

const API_VERSION = "2025-01";
const MAX_RETRIES = 3;

async function graphqlRequest<T>(
  creds: ShopifyCredentials,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(`https://${creds.domain}/admin/api/${API_VERSION}/graphql.json`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Shopify-Access-Token": creds.accessToken,
        },
        body: JSON.stringify({ query, variables }),
      });

      if (res.status === 429) {
        // Rate limit — retry avec backoff exponentiel.
        await sleep(attempt * 1000);
        continue;
      }
      if (!res.ok) {
        throw new ShopifyApiError(`Shopify Admin API a répondu ${res.status}`, res.status);
      }
      const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
      if (json.errors?.length) {
        throw new ShopifyApiError(json.errors.map((e) => e.message).join("; "));
      }
      if (!json.data) throw new ShopifyApiError("Réponse Shopify vide");
      return json.data;
    } catch (err) {
      lastError = err;
      if (attempt < MAX_RETRIES) await sleep(attempt * 500);
    }
  }
  throw lastError instanceof Error ? lastError : new ShopifyApiError("Échec de connexion à Shopify");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Vérifie que les credentials sont valides (utilisé lors de la connexion). */
export async function verifyShopifyCredentials(creds: ShopifyCredentials): Promise<{ shopName: string }> {
  const data = await graphqlRequest<{ shop: { name: string } }>(creds, `query { shop { name } }`);
  return { shopName: data.shop.name };
}

export interface ShopifyVariantNode {
  id: string;
  title: string;
  sku: string | null;
  price: string;
  compareAtPrice: string | null;
  inventoryQuantity: number | null;
  // Coût unitaire RÉEL renseigné dans Shopify (inventoryItem.unitCost) —
  // null si le marchand ne l'a pas saisi. Jamais confondu avec les
  // CostAssumption saisies dans OnDeal.
  inventoryItem: { tracked: boolean; unitCost: { amount: string; currencyCode: string } | null } | null;
}

export interface ShopifyProductNode {
  id: string;
  handle: string;
  title: string;
  status: string;
  productType: string | null;
  vendor: string | null;
  createdAt: string;
  featuredImage: { url: string } | null;
  variants: {
    nodes: ShopifyVariantNode[];
  };
}

interface PageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

const VARIANT_FIELDS = `id title sku price compareAtPrice inventoryQuantity inventoryItem { tracked unitCost { amount currencyCode } }`;

// Pagination COMPLÈTE des variantes : première page de 100 par produit dans
// la requête catalogue, puis `PRODUCT_VARIANTS_QUERY` tant que
// `hasNextPage` est vrai. Un produit Shopify peut avoir jusqu'à 100
// variantes (2 000 avec l'option étendue) : l'ancienne limite `first: 25`
// tronquait silencieusement tout produit au-delà de 25 variantes.
const PRODUCTS_QUERY = `
  query Products($cursor: String) {
    products(first: 50, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        handle
        title
        status
        productType
        vendor
        createdAt
        featuredImage { url }
        variants(first: 100) {
          pageInfo { hasNextPage endCursor }
          nodes { ${VARIANT_FIELDS} }
        }
      }
    }
  }
`;

const PRODUCT_VARIANTS_QUERY = `
  query ProductVariants($productId: ID!, $cursor: String) {
    product(id: $productId) {
      variants(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes { ${VARIANT_FIELDS} }
      }
    }
  }
`;

export interface FetchStats {
  pages: number;
  /** Nombre de requêtes de continuation (variantes ou lignes au-delà de la première page). */
  continuationRequests: number;
}

/** Récupère TOUT le catalogue avec pagination automatique des produits ET des variantes (PHASE 15/19). */
export async function fetchAllProducts(
  creds: ShopifyCredentials,
  onPage?: (nodes: ShopifyProductNode[]) => void,
  stats?: FetchStats,
): Promise<ShopifyProductNode[]> {
  const all: ShopifyProductNode[] = [];
  let cursor: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const data: {
      products: {
        pageInfo: PageInfo;
        nodes: Array<Omit<ShopifyProductNode, "variants"> & { variants: { pageInfo: PageInfo; nodes: ShopifyVariantNode[] } }>;
      };
    } = await graphqlRequest(creds, PRODUCTS_QUERY, { cursor });
    if (stats) stats.pages += 1;

    const pageNodes: ShopifyProductNode[] = [];
    for (const p of data.products.nodes) {
      const variants = [...p.variants.nodes];
      let vCursor = p.variants.pageInfo.endCursor;
      let vHasNext = p.variants.pageInfo.hasNextPage;
      while (vHasNext) {
        const more: { product: { variants: { pageInfo: PageInfo; nodes: ShopifyVariantNode[] } } | null } = await graphqlRequest(
          creds,
          PRODUCT_VARIANTS_QUERY,
          { productId: p.id, cursor: vCursor },
        );
        if (stats) stats.continuationRequests += 1;
        if (!more.product) break;
        variants.push(...more.product.variants.nodes);
        vHasNext = more.product.variants.pageInfo.hasNextPage;
        vCursor = more.product.variants.pageInfo.endCursor;
      }
      pageNodes.push({ ...p, variants: { nodes: variants } });
    }

    all.push(...pageNodes);
    onPage?.(pageNodes);
    hasNextPage = data.products.pageInfo.hasNextPage;
    cursor = data.products.pageInfo.endCursor;
  }

  return all;
}

const LINE_ITEM_FIELDS = `id quantity currentQuantity originalTotalSet { shopMoney { amount } } discountedTotalSet { shopMoney { amount } } product { id } variant { id }`;

// Commandes : entités complètes (annulation, statut financier, total,
// remboursé) et lignes avec variante, pagination des lignes au-delà de 100.
const ORDERS_QUERY = `
  query Orders($cursor: String, $query: String) {
    orders(first: 50, after: $cursor, query: $query, sortKey: CREATED_AT) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        name
        createdAt
        cancelledAt
        displayFinancialStatus
        currentTotalPriceSet { shopMoney { amount currencyCode } }
        totalRefundedSet { shopMoney { amount } }
        lineItems(first: 100) {
          pageInfo { hasNextPage endCursor }
          nodes { ${LINE_ITEM_FIELDS} }
        }
      }
    }
  }
`;

const ORDER_LINES_QUERY = `
  query OrderLines($orderId: ID!, $cursor: String) {
    order(id: $orderId) {
      lineItems(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes { ${LINE_ITEM_FIELDS} }
      }
    }
  }
`;

export interface ShopifyOrderLineItem {
  id: string;
  quantity: number;
  /** Quantité restante après retraits/remboursements d'articles (Shopify `currentQuantity`). */
  currentQuantity: number;
  /** Montant de ligne AVANT remises. */
  originalTotal: number;
  /** Montant de ligne APRÈS remises (ligne + allocation des remises commande). */
  discountedTotal: number;
  productId: string | null;
  variantId: string | null;
}

export interface ShopifyOrderNode {
  id: string;
  name: string | null;
  createdAt: string;
  cancelledAt: string | null;
  financialStatus: string | null;
  currencyCode: string | null;
  totalPrice: number | null;
  totalRefunded: number | null;
  lineItems: ShopifyOrderLineItem[];
}

interface RawLineItem {
  id: string;
  quantity: number;
  currentQuantity: number;
  originalTotalSet: { shopMoney: { amount: string } };
  discountedTotalSet: { shopMoney: { amount: string } };
  product: { id: string } | null;
  variant: { id: string } | null;
}

interface RawOrder {
  id: string;
  name: string | null;
  createdAt: string;
  cancelledAt: string | null;
  displayFinancialStatus: string | null;
  currentTotalPriceSet: { shopMoney: { amount: string; currencyCode: string } } | null;
  totalRefundedSet: { shopMoney: { amount: string } } | null;
  lineItems: { pageInfo: PageInfo; nodes: RawLineItem[] };
}

export function mapLineItem(li: RawLineItem): ShopifyOrderLineItem {
  return {
    id: li.id,
    quantity: li.quantity,
    currentQuantity: li.currentQuantity,
    originalTotal: Number(li.originalTotalSet.shopMoney.amount) || 0,
    discountedTotal: Number(li.discountedTotalSet.shopMoney.amount) || 0,
    productId: li.product?.id ?? null,
    variantId: li.variant?.id ?? null,
  };
}

export function mapOrder(o: Omit<RawOrder, "lineItems">, lineItems: RawLineItem[]): ShopifyOrderNode {
  return {
    id: o.id,
    name: o.name ?? null,
    createdAt: o.createdAt,
    cancelledAt: o.cancelledAt ?? null,
    financialStatus: o.displayFinancialStatus ?? null,
    currencyCode: o.currentTotalPriceSet?.shopMoney.currencyCode ?? null,
    totalPrice: o.currentTotalPriceSet ? Number(o.currentTotalPriceSet.shopMoney.amount) : null,
    totalRefunded: o.totalRefundedSet ? Number(o.totalRefundedSet.shopMoney.amount) : null,
    lineItems: lineItems.map(mapLineItem),
  };
}

// ---------------------------------------------------------------------------
// MUTATIONS — PHASE 13 (Actions sensibles). Chaque fonction n'est appelée
// qu'après validation humaine explicite (voir src/app/api/actions/[id]/execute
// /route.ts) : aucune n'est jamais déclenchée automatiquement par le moteur
// de recommandations lui-même.
// ---------------------------------------------------------------------------

const UPDATE_PRICE_MUTATION = `
  mutation UpdatePrice($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants { id price }
      userErrors { field message }
    }
  }
`;

export async function updateVariantPrice(
  creds: ShopifyCredentials,
  productGid: string,
  variantGid: string,
  newPrice: number,
): Promise<{ ok: true; price: string } | { ok: false; error: string }> {
  const data = await graphqlRequest<{
    productVariantsBulkUpdate: { productVariants: Array<{ id: string; price: string }>; userErrors: Array<{ message: string }> };
  }>(creds, UPDATE_PRICE_MUTATION, {
    productId: productGid,
    variants: [{ id: variantGid, price: newPrice.toFixed(2) }],
  });
  const errors = data.productVariantsBulkUpdate.userErrors;
  if (errors.length > 0) return { ok: false, error: errors.map((e) => e.message).join("; ") };
  const updated = data.productVariantsBulkUpdate.productVariants[0];
  if (!updated) return { ok: false, error: "Aucune variante retournée par Shopify." };
  return { ok: true, price: updated.price };
}

const PRODUCT_STATUS_MUTATION = `
  mutation UpdateStatus($input: ProductInput!) {
    productUpdate(input: $input) {
      product { id status }
      userErrors { field message }
    }
  }
`;

export async function updateProductStatus(
  creds: ShopifyCredentials,
  productGid: string,
  status: "ACTIVE" | "DRAFT" | "ARCHIVED",
): Promise<{ ok: true; status: string } | { ok: false; error: string }> {
  const data = await graphqlRequest<{
    productUpdate: { product: { id: string; status: string } | null; userErrors: Array<{ message: string }> };
  }>(creds, PRODUCT_STATUS_MUTATION, { input: { id: productGid, status } });
  const errors = data.productUpdate.userErrors;
  if (errors.length > 0) return { ok: false, error: errors.map((e) => e.message).join("; ") };
  if (!data.productUpdate.product) return { ok: false, error: "Aucun produit retourné par Shopify." };
  return { ok: true, status: data.productUpdate.product.status };
}

/**
 * Récupère les commandes des `days` derniers jours avec pagination complète
 * des commandes ET de leurs lignes (l'ancienne limite `lineItems(first: 50)`
 * tronquait silencieusement les grosses commandes). Lecture seule.
 */
export async function fetchRecentOrders(creds: ShopifyCredentials, days: number, stats?: FetchStats): Promise<ShopifyOrderNode[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const all: ShopifyOrderNode[] = [];
  let cursor: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const data: { orders: { pageInfo: PageInfo; nodes: RawOrder[] } } = await graphqlRequest(creds, ORDERS_QUERY, {
      cursor,
      query: `created_at:>=${since}`,
    });
    if (stats) stats.pages += 1;

    for (const o of data.orders.nodes) {
      const lines = [...o.lineItems.nodes];
      let lCursor = o.lineItems.pageInfo.endCursor;
      let lHasNext = o.lineItems.pageInfo.hasNextPage;
      while (lHasNext) {
        const more: { order: { lineItems: { pageInfo: PageInfo; nodes: RawLineItem[] } } | null } = await graphqlRequest(
          creds,
          ORDER_LINES_QUERY,
          { orderId: o.id, cursor: lCursor },
        );
        if (stats) stats.continuationRequests += 1;
        if (!more.order) break;
        lines.push(...more.order.lineItems.nodes);
        lHasNext = more.order.lineItems.pageInfo.hasNextPage;
        lCursor = more.order.lineItems.pageInfo.endCursor;
      }
      all.push(mapOrder(o, lines));
    }
    hasNextPage = data.orders.pageInfo.hasNextPage;
    cursor = data.orders.pageInfo.endCursor;
  }

  return all;
}
