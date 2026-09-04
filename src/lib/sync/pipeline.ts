import { prisma } from "@/lib/db";
import { decryptJson } from "@/lib/crypto";
import { logAudit } from "@/lib/audit";
import {
  fetchAllProducts,
  fetchRecentOrders,
  type FetchStats,
  type ShopifyCredentials,
} from "@/lib/integrations/shopify";
import { fetchAllReviews, type JudgemeCredentials } from "@/lib/integrations/judgeme";
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
    const creds = decryptJson<ShopifyCredentials>(integration.encryptedCredentials);

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
