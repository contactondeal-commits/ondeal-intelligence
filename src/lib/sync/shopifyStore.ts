import { prisma } from "@/lib/db";
import type { ShopifyProductNode, ShopifyOrderNode } from "@/lib/integrations/shopify";
import { normalizeVariant, normalizeHandle, type NormalizeIssue } from "@/lib/validation/normalize";

/**
 * Étape STORE du pipeline de synchronisation, isolée du FETCH pour être
 * réutilisable telle quelle par (1) la synchronisation live (jeton Admin
 * API saisi par le marchand dans Settings › Intégrations) et (2) l'import
 * d'un export bulk Shopify (fichier JSONL produit par une bulk operation,
 * en lecture seule). Même normalisation, mêmes upserts, mêmes clés
 * d'unicité : deux chemins d'entrée, une seule vérité en base.
 *
 * Règles : aucune donnée réelle n'est jamais écrasée par une donnée de
 * démonstration (une boutique `isDemo` est refusée en amont), `supplierStock`
 * n'est JAMAIS écrit ici (démo uniquement), et `unitCost` reste null tant que
 * Shopify ne le fournit pas — jamais remplacé par 0 ni par une hypothèse.
 */

export interface ProductStoreStats {
  productsRead: number;
  productsStored: number;
  variantsRead: number;
  variantsStored: number;
  variantsRejected: number;
  variantsWithUnitCost: number;
  variantsWithoutUnitCost: number;
  /** Devises de coût unitaire différentes de la devise de la boutique (à surveiller : les marges seraient faussées). */
  unitCostCurrencyMismatch: number;
  issueCountsByProblem: Record<string, number>;
  durationMs: number;
}

const ISSUE_SAMPLE_MAX = 20;

export async function storeProducts(
  storeId: string,
  storeCurrency: string,
  products: ShopifyProductNode[],
  issues: NormalizeIssue[],
): Promise<ProductStoreStats> {
  const started = Date.now();
  const stats: ProductStoreStats = {
    productsRead: products.length,
    productsStored: 0,
    variantsRead: 0,
    variantsStored: 0,
    variantsRejected: 0,
    variantsWithUnitCost: 0,
    variantsWithoutUnitCost: 0,
    unitCostCurrencyMismatch: 0,
    issueCountsByProblem: {},
    durationMs: 0,
  };

  const pushIssue = (issue: NormalizeIssue) => {
    stats.issueCountsByProblem[issue.problem] = (stats.issueCountsByProblem[issue.problem] ?? 0) + 1;
    if (issues.length < ISSUE_SAMPLE_MAX) issues.push(issue);
  };

  for (const p of products) {
    const { handle, issue: handleIssue } = normalizeHandle(p.handle, p.id);
    if (handleIssue) pushIssue(handleIssue);

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
        createdAtShopify: p.createdAt ? new Date(p.createdAt) : null,
      },
      update: {
        handle,
        title: p.title || "(sans titre)",
        status: p.status.toLowerCase(),
        productType: p.productType,
        vendor: p.vendor,
        imageUrl: p.featuredImage?.url ?? null,
      },
      select: { id: true },
    });
    stats.productsStored += 1;

    const variantOps = [];
    for (const rawVariant of p.variants.nodes) {
      stats.variantsRead += 1;
      const { variant, issues: variantIssues } = normalizeVariant(rawVariant);
      variantIssues.forEach(pushIssue);
      if (!variant) {
        stats.variantsRejected += 1;
        continue;
      }
      if (variant.unitCost !== null) {
        stats.variantsWithUnitCost += 1;
        if (variant.unitCostCurrency && variant.unitCostCurrency !== storeCurrency) stats.unitCostCurrencyMismatch += 1;
      } else {
        stats.variantsWithoutUnitCost += 1;
      }

      const fields = {
        title: variant.title,
        sku: variant.sku,
        price: variant.price,
        compareAtPrice: variant.compareAtPrice,
        inventoryQuantity: variant.inventoryQuantity,
        unitCost: variant.unitCost,
        unitCostCurrency: variant.unitCostCurrency,
      };
      variantOps.push(
        prisma.variant.upsert({
          where: { productId_shopifyVariantId: { productId: product.id, shopifyVariantId: variant.shopifyVariantId } },
          create: { productId: product.id, shopifyVariantId: variant.shopifyVariantId, ...fields },
          update: fields,
          select: { id: true },
        }),
      );
    }
    if (variantOps.length > 0) {
      // Une transaction batch par produit : toutes ses variantes en un
      // aller-retour, sans transaction interactive longue (SQLite).
      await prisma.$transaction(variantOps);
      stats.variantsStored += variantOps.length;
    }
  }

  stats.durationMs = Date.now() - started;
  return stats;
}

export interface OrderStoreStats {
  ordersRead: number;
  ordersStored: number;
  ordersCancelled: number;
  ordersWithRefund: number;
  linesRead: number;
  linesStored: number;
  linesWithVariantId: number;
  linesWithoutVariantId: number;
  linesWithVariantNotInCatalog: number;
  linesWithProductNotInCatalog: number;
  durationMs: number;
}

export async function storeOrders(storeId: string, orders: ShopifyOrderNode[]): Promise<OrderStoreStats> {
  const started = Date.now();
  const stats: OrderStoreStats = {
    ordersRead: orders.length,
    ordersStored: 0,
    ordersCancelled: 0,
    ordersWithRefund: 0,
    linesRead: 0,
    linesStored: 0,
    linesWithVariantId: 0,
    linesWithoutVariantId: 0,
    linesWithVariantNotInCatalog: 0,
    linesWithProductNotInCatalog: 0,
    durationMs: 0,
  };

  // Résolution des identifiants Shopify → identifiants OnDeal, en une seule
  // lecture pour tout le lot (pas une requête par ligne).
  const shopifyProductIds = new Set<string>();
  const shopifyVariantIds = new Set<string>();
  for (const o of orders) {
    for (const li of o.lineItems) {
      if (li.productId) shopifyProductIds.add(li.productId);
      if (li.variantId) shopifyVariantIds.add(li.variantId);
    }
  }
  const products = shopifyProductIds.size
    ? await prisma.product.findMany({
        where: { storeId, shopifyProductId: { in: [...shopifyProductIds] } },
        select: { id: true, shopifyProductId: true },
      })
    : [];
  const productIdByShopify = new Map(products.map((p) => [p.shopifyProductId, p.id]));
  const variants = shopifyVariantIds.size
    ? await prisma.variant.findMany({
        where: { product: { storeId }, shopifyVariantId: { in: [...shopifyVariantIds] } },
        select: { id: true, shopifyVariantId: true },
      })
    : [];
  const variantIdByShopify = new Map(variants.map((v) => [v.shopifyVariantId, v.id]));

  for (const o of orders) {
    const orderFields = {
      name: o.name,
      createdAtShopify: new Date(o.createdAt),
      cancelledAt: o.cancelledAt ? new Date(o.cancelledAt) : null,
      financialStatus: o.financialStatus,
      currencyCode: o.currencyCode,
      totalPrice: o.totalPrice,
      totalRefunded: o.totalRefunded,
      fetchedAt: new Date(),
    };
    const order = await prisma.order.upsert({
      where: { storeId_shopifyOrderId: { storeId, shopifyOrderId: o.id } },
      create: { storeId, shopifyOrderId: o.id, ...orderFields },
      update: orderFields,
      select: { id: true },
    });
    stats.ordersStored += 1;
    if (o.cancelledAt) stats.ordersCancelled += 1;
    if (o.totalRefunded !== null && o.totalRefunded > 0) stats.ordersWithRefund += 1;

    const lineOps = [];
    for (const li of o.lineItems) {
      stats.linesRead += 1;
      if (li.variantId) stats.linesWithVariantId += 1;
      else stats.linesWithoutVariantId += 1;
      const productId = li.productId ? (productIdByShopify.get(li.productId) ?? null) : null;
      const variantId = li.variantId ? (variantIdByShopify.get(li.variantId) ?? null) : null;
      if (li.productId && !productId) stats.linesWithProductNotInCatalog += 1;
      if (li.variantId && !variantId) stats.linesWithVariantNotInCatalog += 1;

      const fields = {
        productId,
        variantId,
        shopifyProductId: li.productId,
        shopifyVariantId: li.variantId,
        quantity: li.quantity,
        currentQuantity: li.currentQuantity,
        originalTotal: li.originalTotal,
        discountedTotal: li.discountedTotal,
      };
      lineOps.push(
        prisma.orderLine.upsert({
          where: { orderId_shopifyLineItemId: { orderId: order.id, shopifyLineItemId: li.id } },
          create: { orderId: order.id, shopifyLineItemId: li.id, ...fields },
          update: fields,
          select: { id: true },
        }),
      );
    }
    if (lineOps.length > 0) {
      await prisma.$transaction(lineOps);
      stats.linesStored += lineOps.length;
    }
  }

  stats.durationMs = Date.now() - started;
  return stats;
}

/**
 * Agrégat quotidien produit × jour dérivé des lignes de commande stockées,
 * pour la fenêtre [since, aujourd'hui]. Sémantique EXPLICITE (voir schéma
 * SalesSnapshot) : unités = quantité commandée, chiffre = montant de ligne
 * après remises, commandes ANNULÉES exclues, remboursements NON déduits.
 * Les jours de la fenêtre sans vente n'ont pas de ligne. La fenêtre est
 * reconstruite intégralement (suppression puis réinsertion) pour qu'une
 * commande annulée depuis la dernière sync disparaisse bien de l'agrégat.
 */
export async function rebuildSalesSnapshots(storeId: string, since: Date): Promise<{ rowsWritten: number; productsWithSales: number }> {
  const lines = await prisma.orderLine.findMany({
    where: { productId: { not: null }, order: { storeId, cancelledAt: null, createdAtShopify: { gte: since } } },
    select: { productId: true, quantity: true, discountedTotal: true, order: { select: { createdAtShopify: true } } },
  });

  const byProductAndDay = new Map<string, { productId: string; day: string; unitsSold: number; revenue: number }>();
  for (const l of lines) {
    const day = l.order.createdAtShopify.toISOString().slice(0, 10);
    const key = `${l.productId}__${day}`;
    const entry = byProductAndDay.get(key) ?? { productId: l.productId as string, day, unitsSold: 0, revenue: 0 };
    entry.unitsSold += l.quantity;
    entry.revenue += l.discountedTotal;
    byProductAndDay.set(key, entry);
  }

  const rows = [...byProductAndDay.values()].map((agg) => ({
    productId: agg.productId,
    date: new Date(agg.day),
    unitsSold: agg.unitsSold,
    revenue: Math.round(agg.revenue * 100) / 100,
  }));

  await prisma.$transaction([
    prisma.salesSnapshot.deleteMany({ where: { product: { storeId }, date: { gte: new Date(since.toISOString().slice(0, 10)) } } }),
    ...(rows.length > 0 ? [prisma.salesSnapshot.createMany({ data: rows })] : []),
  ]);

  return { rowsWritten: rows.length, productsWithSales: new Set(rows.map((r) => r.productId)).size };
}
