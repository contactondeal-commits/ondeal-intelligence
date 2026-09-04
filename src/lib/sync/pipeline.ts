import { prisma } from "@/lib/db";
import { decryptJson } from "@/lib/crypto";
import { logAudit } from "@/lib/audit";
import {
  fetchAllProducts,
  fetchRecentOrders,
  type FetchStats,
  type ShopifyProductNode,
  type ShopifyOrderNode,
} from "@/lib/integrations/shopify";
import { getFreshShopifyCredentials } from "@/lib/integrations/shopify-token";
import { fetchAllReviews, type JudgemeCredentials } from "@/lib/integrations/judgeme";
import {
  fetchAllProducts as fetchAllWooCommerceProducts,
  fetchRecentOrders as fetchRecentWooCommerceOrders,
  type WooCommerceCredentials,
} from "@/lib/integrations/woocommerce";
import {
  fetchAllProducts as fetchAllPrestaShopProducts,
  fetchRecentOrders as fetchRecentPrestaShopOrders,
  type PrestaShopCredentials,
} from "@/lib/integrations/prestashop";
import type { NormalizeIssue } from "@/lib/validation/normalize";
import { recomputeStoreIntelligence } from "@/lib/intelligence/pipeline";
import { storeProducts, storeOrders, rebuildSalesSnapshots, rebuildMarginSnapshots } from "@/lib/sync/shopifyStore";

// PHASE 15 — Synchronisation : FETCH → VALIDATE → NORMALIZE → STORE →
// ANALYZE → INSIGHTS. Chaque étape est tracée dans SyncRun + AuditLog.
// Synchronisation manuelle (déclenchée depuis l'UI) et automatique
// (planifiée) partagent ce même pipeline (voir docs/ARCHITECTURE.md).
// L'étape STORE vit dans `shopifyStore.ts`, partagée avec l'import bulk.

/** Fenêtre de commandes lue à chaque synchronisation (jours). */
export const ORDERS_WINDOW_DAYS = 90;

export async function syncShopify(storeId: string, triggeredBy: "manual" | "scheduled"): Promise<{
  status: "success" | "partial" | "error" | "not_connected" | "refused_demo";
  itemsFetched: number;
  itemsStored: number;
  errorCount: number;
}> {
  // Une boutique de démonstration n'est JAMAIS synchronisée : ses données
  // fictives ne doivent ni être écrasées par des données réelles, ni
  // l'inverse. Refus explicite, tracé.
  const store = await prisma.store.findUnique({ where: { id: storeId }, select: { isDemo: true, currency: true } });
  if (!store) return { status: "error", itemsFetched: 0, itemsStored: 0, errorCount: 1 };
  if (store.isDemo) return { status: "refused_demo", itemsFetched: 0, itemsStored: 0, errorCount: 0 };

  const integration = await prisma.integration.findUnique({
    where: { storeId_provider: { storeId, provider: "SHOPIFY" } },
  });

  if (!integration || integration.status !== "CONNECTED" || !integration.encryptedCredentials) {
    return { status: "not_connected", itemsFetched: 0, itemsStored: 0, errorCount: 0 };
  }

  const run = await prisma.syncRun.create({
    data: { storeId, provider: "SHOPIFY", status: "running", triggeredBy },
  });

  let itemsFetched = 0;
  let itemsStored = 0;
  const issues: NormalizeIssue[] = [];
  const stats: Record<string, unknown> = {};

  try {
    // Rafraîchit un jeton EXPIRANT proche de l'échéance avant de l'utiliser
    // (04/09/2026 — correctif : voir shopify-token.ts) ; no-op pour un
    // jeton classique non-expirant, comportement inchangé pour ce cas.
    const creds = await getFreshShopifyCredentials(integration);

    // FETCH produits + variantes (pagination complète)
    const fetchStats: FetchStats = { pages: 0, continuationRequests: 0 };
    const fetchStarted = Date.now();
    const products = await fetchAllProducts(creds, undefined, fetchStats);
    stats.productsFetch = { ...fetchStats, durationMs: Date.now() - fetchStarted };
    itemsFetched = products.length;

    // VALIDATE + NORMALIZE + STORE
    const productStats = await storeProducts(storeId, store.currency, products, issues);
    stats.products = productStats;
    itemsStored = productStats.productsStored;

    // Commandes + lignes (pagination complète) → entités → agrégat quotidien
    try {
      const orderFetchStats: FetchStats = { pages: 0, continuationRequests: 0 };
      const orderFetchStarted = Date.now();
      const orders = await fetchRecentOrders(creds, ORDERS_WINDOW_DAYS, orderFetchStats);
      stats.ordersFetch = { ...orderFetchStats, windowDays: ORDERS_WINDOW_DAYS, durationMs: Date.now() - orderFetchStarted };
      stats.orders = await storeOrders(storeId, orders);
      stats.salesSnapshots = await rebuildSalesSnapshots(storeId, new Date(Date.now() - ORDERS_WINDOW_DAYS * 24 * 60 * 60 * 1000));
      stats.marginSnapshots = await rebuildMarginSnapshots(storeId, new Date(Date.now() - ORDERS_WINDOW_DAYS * 24 * 60 * 60 * 1000));
    } catch (err) {
      issues.push({ field: "orders", problem: `Échec de récupération des commandes: ${String(err)}`, original: null, corrected: null });
      stats.ordersError = String(err);
    }

    await prisma.integration.update({
      where: { id: integration.id },
      data: { lastSyncedAt: new Date(), lastError: null },
    });

    // Distinction explicite : une ERREUR est une donnée non stockée (variante
    // rejetée, commandes non lues) ; un SIGNALEMENT QUALITÉ est une donnée
    // stockée telle quelle mais incohérente (prix barré ≤ prix…). Les deux
    // sont tracés, seuls les premiers dégradent le statut du SyncRun.
    const qualityWarnings = Object.values(productStats.issueCountsByProblem).reduce((s, n) => s + n, 0);
    const hardErrors = productStats.variantsRejected + (stats.ordersError ? 1 : 0);
    stats.qualityWarnings = qualityWarnings;
    stats.hardErrors = hardErrors;
    await prisma.syncRun.update({
      where: { id: run.id },
      data: {
        status: hardErrors > 0 ? "partial" : "success",
        finishedAt: new Date(),
        itemsFetched,
        itemsStored,
        errorCount: hardErrors,
        errorSample: issues.length > 0 ? JSON.stringify(issues.slice(0, 20)) : null,
        statsJson: JSON.stringify(stats),
      },
    });

    await logAudit({
      storeId,
      actorType: "system",
      event: "sync.completed",
      message: `Synchronisation Shopify : ${itemsStored}/${itemsFetched} produits, ${productStats.variantsStored} variantes (${productStats.variantsWithUnitCost} avec coût unitaire Shopify), ${hardErrors} erreur(s), ${qualityWarnings} signalement(s) qualité.`,
      meta: { itemsFetched, itemsStored, hardErrors, qualityWarnings },
    });

    // ANALYZE → INSIGHTS
    await recomputeStoreIntelligence(storeId);

    return {
      status: hardErrors > 0 ? "partial" : "success",
      itemsFetched,
      itemsStored,
      errorCount: hardErrors,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.integration.update({ where: { id: integration.id }, data: { lastError: message, status: "ERROR" } });
    await prisma.syncRun.update({
      where: { id: run.id },
      data: { status: "error", finishedAt: new Date(), itemsFetched, itemsStored, errorCount: issues.length + 1 },
    });
    await logAudit({
      storeId,
      actorType: "system",
      event: "sync.failed",
      message: `Échec de synchronisation Shopify : ${message}`,
    });
    return { status: "error", itemsFetched, itemsStored, errorCount: issues.length + 1 };
  }
}

// WOOCOMMERCE/PRESTASHOP (04/09/2026) — connecteurs catalogue alternatifs à
// Shopify (voir woocommerce.ts/prestashop.ts pour ce qui rend ça possible :
// mêmes formes ShopifyProductNode/ShopifyOrderNode en sortie). `syncShopify`
// ci-dessus n'est PAS modifié — chemin déjà vérifié en production, il
// continue d'exister tel quel et intact. `runCatalogSync` ci-dessous est un
// SECOND chemin, factorisé entre WooCommerce et PrestaShop uniquement (pas
// de jeton expirant à rafraîchir pour ces deux plateformes — clés statiques,
// contrairement à Shopify — donc pas d'équivalent de getFreshShopifyCredentials
// ici), pour ne pas dupliquer deux fois la même logique STORE/ANALYZE.
async function runCatalogSync<C>(
  storeId: string,
  triggeredBy: "manual" | "scheduled",
  provider: "WOOCOMMERCE" | "PRESTASHOP",
  providerLabel: string,
  fetchProducts: (creds: C, onPage: undefined, stats: FetchStats) => Promise<ShopifyProductNode[]>,
  fetchOrders: (creds: C, days: number, stats: FetchStats) => Promise<ShopifyOrderNode[]>,
): Promise<{
  status: "success" | "partial" | "error" | "not_connected" | "refused_demo";
  itemsFetched: number;
  itemsStored: number;
  errorCount: number;
}> {
  const store = await prisma.store.findUnique({ where: { id: storeId }, select: { isDemo: true, currency: true } });
  if (!store) return { status: "error", itemsFetched: 0, itemsStored: 0, errorCount: 1 };
  if (store.isDemo) return { status: "refused_demo", itemsFetched: 0, itemsStored: 0, errorCount: 0 };

  const integration = await prisma.integration.findUnique({ where: { storeId_provider: { storeId, provider } } });
  if (!integration || integration.status !== "CONNECTED" || !integration.encryptedCredentials) {
    return { status: "not_connected", itemsFetched: 0, itemsStored: 0, errorCount: 0 };
  }

  const run = await prisma.syncRun.create({ data: { storeId, provider, status: "running", triggeredBy } });

  let itemsFetched = 0;
  let itemsStored = 0;
  const issues: NormalizeIssue[] = [];
  const stats: Record<string, unknown> = {};

  try {
    const creds = decryptJson<C>(integration.encryptedCredentials);

    const fetchStats: FetchStats = { pages: 0, continuationRequests: 0 };
    const fetchStarted = Date.now();
    const products = await fetchProducts(creds, undefined, fetchStats);
    stats.productsFetch = { ...fetchStats, durationMs: Date.now() - fetchStarted };
    itemsFetched = products.length;

    const productStats = await storeProducts(storeId, store.currency, products, issues);
    stats.products = productStats;
    itemsStored = productStats.productsStored;

    try {
      const orderFetchStats: FetchStats = { pages: 0, continuationRequests: 0 };
      const orderFetchStarted = Date.now();
      const orders = await fetchOrders(creds, ORDERS_WINDOW_DAYS, orderFetchStats);
      stats.ordersFetch = { ...orderFetchStats, windowDays: ORDERS_WINDOW_DAYS, durationMs: Date.now() - orderFetchStarted };
      stats.orders = await storeOrders(storeId, orders);
      stats.salesSnapshots = await rebuildSalesSnapshots(storeId, new Date(Date.now() - ORDERS_WINDOW_DAYS * 24 * 60 * 60 * 1000));
      stats.marginSnapshots = await rebuildMarginSnapshots(storeId, new Date(Date.now() - ORDERS_WINDOW_DAYS * 24 * 60 * 60 * 1000));
    } catch (err) {
      issues.push({ field: "orders", problem: `Échec de récupération des commandes: ${String(err)}`, original: null, corrected: null });
      stats.ordersError = String(err);
    }

    await prisma.integration.update({ where: { id: integration.id }, data: { lastSyncedAt: new Date(), lastError: null } });

    const qualityWarnings = Object.values(productStats.issueCountsByProblem).reduce((s, n) => s + n, 0);
    const hardErrors = productStats.variantsRejected + (stats.ordersError ? 1 : 0);
    stats.qualityWarnings = qualityWarnings;
    stats.hardErrors = hardErrors;
    await prisma.syncRun.update({
      where: { id: run.id },
      data: {
        status: hardErrors > 0 ? "partial" : "success",
        finishedAt: new Date(),
        itemsFetched,
        itemsStored,
        errorCount: hardErrors,
        errorSample: issues.length > 0 ? JSON.stringify(issues.slice(0, 20)) : null,
        statsJson: JSON.stringify(stats),
      },
    });

    await logAudit({
      storeId,
      actorType: "system",
      event: "sync.completed",
      message: `Synchronisation ${providerLabel} : ${itemsStored}/${itemsFetched} produits, ${productStats.variantsStored} variantes (${productStats.variantsWithUnitCost} avec coût unitaire), ${hardErrors} erreur(s), ${qualityWarnings} signalement(s) qualité.`,
      meta: { itemsFetched, itemsStored, hardErrors, qualityWarnings },
    });

    await recomputeStoreIntelligence(storeId);

    return { status: hardErrors > 0 ? "partial" : "success", itemsFetched, itemsStored, errorCount: hardErrors };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.integration.update({ where: { id: integration.id }, data: { lastError: message, status: "ERROR" } });
    await prisma.syncRun.update({
      where: { id: run.id },
      data: { status: "error", finishedAt: new Date(), itemsFetched, itemsStored, errorCount: issues.length + 1 },
    });
    await logAudit({ storeId, actorType: "system", event: "sync.failed", message: `Échec de synchronisation ${providerLabel} : ${message}` });
    return { status: "error", itemsFetched, itemsStored, errorCount: issues.length + 1 };
  }
}

export async function syncWooCommerce(storeId: string, triggeredBy: "manual" | "scheduled") {
  return runCatalogSync<WooCommerceCredentials>(
    storeId,
    triggeredBy,
    "WOOCOMMERCE",
    "WooCommerce",
    fetchAllWooCommerceProducts,
    fetchRecentWooCommerceOrders,
  );
}

export async function syncPrestaShop(storeId: string, triggeredBy: "manual" | "scheduled") {
  return runCatalogSync<PrestaShopCredentials>(
    storeId,
    triggeredBy,
    "PRESTASHOP",
    "PrestaShop",
    fetchAllPrestaShopProducts,
    fetchRecentPrestaShopOrders,
  );
}

/**
 * Point d'entrée UNIQUE pour la synchro catalogue, utilisé par /api/sync et
 * /api/cron/sync — plutôt que de leur faire deviner quelle plateforme est
 * connectée. Regarde quelle intégration catalogue (SHOPIFY, WOOCOMMERCE ou
 * PRESTASHOP — au plus une CONNECTED à la fois par boutique, voir
 * /api/integrations/connect) est active pour la boutique et appelle la
 * bonne fonction. Aucune connectée → "not_connected", sans erreur.
 */
export async function syncCatalog(storeId: string, triggeredBy: "manual" | "scheduled"): Promise<{
  status: "success" | "partial" | "error" | "not_connected" | "refused_demo";
  itemsFetched: number;
  itemsStored: number;
  errorCount: number;
  provider: "SHOPIFY" | "WOOCOMMERCE" | "PRESTASHOP" | null;
}> {
  const catalogIntegrations = await prisma.integration.findMany({
    where: { storeId, provider: { in: ["SHOPIFY", "WOOCOMMERCE", "PRESTASHOP"] }, status: "CONNECTED" },
    select: { provider: true },
  });
  const provider = (catalogIntegrations[0]?.provider as "SHOPIFY" | "WOOCOMMERCE" | "PRESTASHOP" | undefined) ?? null;

  if (!provider) return { status: "not_connected", itemsFetched: 0, itemsStored: 0, errorCount: 0, provider: null };

  const result =
    provider === "SHOPIFY"
      ? await syncShopify(storeId, triggeredBy)
      : provider === "WOOCOMMERCE"
        ? await syncWooCommerce(storeId, triggeredBy)
        : await syncPrestaShop(storeId, triggeredBy);

  return { ...result, provider };
}

export async function syncJudgeme(storeId: string, triggeredBy: "manual" | "scheduled"): Promise<{
  status: "success" | "error" | "not_connected";
  itemsFetched: number;
  itemsStored: number;
}> {
  const integration = await prisma.integration.findUnique({
    where: { storeId_provider: { storeId, provider: "JUDGEME" } },
  });
  if (!integration || integration.status !== "CONNECTED" || !integration.encryptedCredentials) {
    return { status: "not_connected", itemsFetched: 0, itemsStored: 0 };
  }

  const run = await prisma.syncRun.create({ data: { storeId, provider: "JUDGEME", status: "running", triggeredBy } });

  try {
    const creds = decryptJson<JudgemeCredentials>(integration.encryptedCredentials);
    const reviews = await fetchAllReviews(creds);

    let stored = 0;
    for (const r of reviews) {
      const product = r.productExternalId
        ? await prisma.product.findUnique({
            where: { storeId_shopifyProductId: { storeId, shopifyProductId: `gid://shopify/Product/${r.productExternalId}` } },
            select: { id: true },
          })
        : null;

      await prisma.review.upsert({
        where: { storeId_externalId: { storeId, externalId: r.externalId } },
        create: {
          storeId,
          productId: product?.id ?? null,
          externalId: r.externalId,
          rating: r.rating,
          title: r.title,
          body: r.body,
          authorName: r.authorName,
          verifiedPurchase: r.verifiedPurchase,
          publishedAt: r.publishedAt,
        },
        update: {
          rating: r.rating,
          title: r.title,
          body: r.body,
          authorName: r.authorName,
          verifiedPurchase: r.verifiedPurchase,
        },
      });
      stored += 1;
    }

    await prisma.integration.update({ where: { id: integration.id }, data: { lastSyncedAt: new Date(), lastError: null } });
    await prisma.syncRun.update({
      where: { id: run.id },
      data: { status: "success", finishedAt: new Date(), itemsFetched: reviews.length, itemsStored: stored },
    });
    await logAudit({
      storeId,
      actorType: "system",
      event: "sync.completed",
      message: `Synchronisation Judge.me : ${stored} avis stockés.`,
      meta: { itemsFetched: reviews.length, itemsStored: stored },
    });

    await recomputeStoreIntelligence(storeId);

    return { status: "success", itemsFetched: reviews.length, itemsStored: stored };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.integration.update({ where: { id: integration.id }, data: { lastError: message, status: "ERROR" } });
    await prisma.syncRun.update({ where: { id: run.id }, data: { status: "error", finishedAt: new Date() } });
    await logAudit({ storeId, actorType: "system", event: "sync.failed", message: `Échec de synchronisation Judge.me : ${message}` });
    return { status: "error", itemsFetched: 0, itemsStored: 0 };
  }
}
