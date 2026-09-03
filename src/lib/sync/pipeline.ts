import { prisma } from "@/lib/db";
import { decryptJson } from "@/lib/crypto";
import { logAudit } from "@/lib/audit";
import {
  fetchAllProducts,
  fetchRecentOrders,
  type ShopifyCredentials,
} from "@/lib/integrations/shopify";
import { fetchAllReviews, type JudgemeCredentials } from "@/lib/integrations/judgeme";
import { normalizeVariant, normalizeHandle, type NormalizeIssue } from "@/lib/validation/normalize";
import { recomputeStoreIntelligence } from "@/lib/intelligence/pipeline";

// PHASE 15 — Synchronisation : FETCH → VALIDATE → NORMALIZE → STORE →
// ANALYZE → INSIGHTS. Chaque étape est tracée dans SyncRun + AuditLog.
// Synchronisation manuelle (déclenchée depuis l'UI) et automatique
// (planifiée) partagent ce même pipeline (voir docs/ARCHITECTURE.md).

export async function syncShopify(storeId: string, triggeredBy: "manual" | "scheduled"): Promise<{
  status: "success" | "partial" | "error" | "not_connected";
  itemsFetched: number;
  itemsStored: number;
  errorCount: number;
}> {
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

  try {
    const creds = decryptJson<ShopifyCredentials>(integration.encryptedCredentials);

    // FETCH
    const products = await fetchAllProducts(creds);
    itemsFetched = products.length;

    // VALIDATE + NORMALIZE + STORE
    for (const p of products) {
      const { handle, issue: handleIssue } = normalizeHandle(p.handle, p.id);
      if (handleIssue) issues.push(handleIssue);

      const product = await prisma.product.upsert({
        where: { storeId_shopifyProductId: { storeId, shopifyProductId: p.id } },
        create: {
          storeId,
          shopifyProductId: p.id,
          handle,
          title: p.title || "(sans titre)",
          status: p.status.toLowerCase(),
          productType: p.productType,
          vendor: p.vendor,
          imageUrl: p.featuredImage?.url ?? null,
          createdAtShopify: new Date(p.createdAt),
        },
        update: {
          handle,
          title: p.title || "(sans titre)",
          status: p.status.toLowerCase(),
          productType: p.productType,
          vendor: p.vendor,
          imageUrl: p.featuredImage?.url ?? null,
        },
      });
      itemsStored += 1;

      for (const rawVariant of p.variants.nodes) {
        const { variant, issues: variantIssues } = normalizeVariant(rawVariant);
        issues.push(...variantIssues);
        if (!variant) continue;

        await prisma.variant.upsert({
          where: { productId_shopifyVariantId: { productId: product.id, shopifyVariantId: variant.shopifyVariantId } },
          create: {
            productId: product.id,
            shopifyVariantId: variant.shopifyVariantId,
            title: variant.title,
            sku: variant.sku,
            price: variant.price,
            compareAtPrice: variant.compareAtPrice,
            inventoryQuantity: variant.inventoryQuantity,
          },
          update: {
            title: variant.title,
            sku: variant.sku,
            price: variant.price,
            compareAtPrice: variant.compareAtPrice,
            inventoryQuantity: variant.inventoryQuantity,
          },
        });
      }
    }

    // Vitesse de vente : commandes des 30 derniers jours → SalesSnapshot quotidien agrégé
    try {
      const orders = await fetchRecentOrders(creds, 30);
      const byProductAndDay = new Map<string, { shopifyProductId: string; day: string; unitsSold: number; revenue: number }>();
      for (const order of orders) {
        const day = order.createdAt.slice(0, 10);
        for (const li of order.lineItems) {
          if (!li.productId) continue;
          const key = `${li.productId}__${day}`;
          const entry = byProductAndDay.get(key) ?? { shopifyProductId: li.productId, day, unitsSold: 0, revenue: 0 };
          entry.unitsSold += li.quantity;
          entry.revenue += li.amount;
          byProductAndDay.set(key, entry);
        }
      }
      for (const agg of byProductAndDay.values()) {
        const product = await prisma.product.findUnique({
          where: { storeId_shopifyProductId: { storeId, shopifyProductId: agg.shopifyProductId } },
          select: { id: true },
        });
        if (!product) continue;
        await prisma.salesSnapshot.upsert({
          where: { productId_date: { productId: product.id, date: new Date(agg.day) } },
          create: { productId: product.id, date: new Date(agg.day), unitsSold: agg.unitsSold, revenue: agg.revenue },
          update: { unitsSold: agg.unitsSold, revenue: agg.revenue },
        });
      }
    } catch (err) {
      issues.push({ field: "orders", problem: `Échec de récupération des commandes: ${String(err)}`, original: null, corrected: null });
    }

    await prisma.integration.update({
      where: { id: integration.id },
      data: { lastSyncedAt: new Date(), lastError: null },
    });

    await prisma.syncRun.update({
      where: { id: run.id },
      data: {
        status: issues.length > 0 ? "partial" : "success",
        finishedAt: new Date(),
        itemsFetched,
        itemsStored,
        errorCount: issues.length,
        errorSample: issues.length > 0 ? JSON.stringify(issues.slice(0, 20)) : null,
      },
    });

    await logAudit({
      storeId,
      actorType: "system",
      event: "sync.completed",
      message: `Synchronisation Shopify : ${itemsStored}/${itemsFetched} produits stockés, ${issues.length} anomalie(s) corrigée(s).`,
      meta: { itemsFetched, itemsStored, issueCount: issues.length },
    });

    // ANALYZE → INSIGHTS
    await recomputeStoreIntelligence(storeId);

    return {
      status: issues.length > 0 ? "partial" : "success",
      itemsFetched,
      itemsStored,
      errorCount: issues.length,
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
