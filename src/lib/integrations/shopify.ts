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
    nodes: Array<{
      id: string;
      title: string;
      sku: string | null;
      price: string;
      compareAtPrice: string | null;
      inventoryQuantity: number | null;
    }>;
  };
}

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
        variants(first: 25) {
          nodes { id title sku price compareAtPrice inventoryQuantity }
        }
      }
    }
  }
`;

/** Récupère TOUT le catalogue avec pagination automatique (PHASE 15/19). */
export async function fetchAllProducts(
  creds: ShopifyCredentials,
  onPage?: (nodes: ShopifyProductNode[]) => void,
): Promise<ShopifyProductNode[]> {
  const all: ShopifyProductNode[] = [];
  let cursor: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const data: {
      products: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: ShopifyProductNode[] };
    } = await graphqlRequest(creds, PRODUCTS_QUERY, { cursor });
    all.push(...data.products.nodes);
    onPage?.(data.products.nodes);
    hasNextPage = data.products.pageInfo.hasNextPage;
    cursor = data.products.pageInfo.endCursor;
  }

  return all;
}

const ORDERS_QUERY = `
  query Orders($cursor: String, $query: String) {
    orders(first: 50, after: $cursor, query: $query) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        createdAt
        lineItems(first: 50) {
          nodes { quantity originalTotalSet { shopMoney { amount } } product { id } }
        }
      }
    }
  }
`;

export interface ShopifyOrderLineItem {
  quantity: number;
  amount: number;
  productId: string | null;
}

export interface ShopifyOrderNode {
  id: string;
  createdAt: string;
  lineItems: ShopifyOrderLineItem[];
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

/** Récupère les commandes des `days` derniers jours (pour la vélocité de vente — PHASE 6). */
export async function fetchRecentOrders(creds: ShopifyCredentials, days: number): Promise<ShopifyOrderNode[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const all: ShopifyOrderNode[] = [];
  let cursor: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const data: {
      orders: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: Array<{
          id: string;
          createdAt: string;
          lineItems: { nodes: Array<{ quantity: number; originalTotalSet: { shopMoney: { amount: string } }; product: { id: string } | null }> };
        }>;
      };
    } = await graphqlRequest(creds, ORDERS_QUERY, { cursor, query: `created_at:>=${since}` });

    for (const o of data.orders.nodes) {
      all.push({
        id: o.id,
        createdAt: o.createdAt,
        lineItems: o.lineItems.nodes.map((li) => ({
          quantity: li.quantity,
          amount: Number(li.originalTotalSet.shopMoney.amount) || 0,
          productId: li.product?.id ?? null,
        })),
      });
    }
    hasNextPage = data.orders.pageInfo.hasNextPage;
    cursor = data.orders.pageInfo.endCursor;
  }

  return all;
}
