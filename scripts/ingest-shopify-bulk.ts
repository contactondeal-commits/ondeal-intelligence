/**
 * Import d'un export BULK Shopify (lecture seule) dans OnDeal.
 *
 * Contexte : le connecteur live (`src/lib/integrations/shopify.ts`) exige un
 * jeton Admin API saisi par le marchand dans Settings › Intégrations. Pour
 * un gros catalogue, Shopify recommande les bulk operations
 * (`bulkOperationRunQuery`), qui produisent un fichier JSONL. Ce script
 * ingère ces fichiers en réutilisant EXACTEMENT l'étape STORE du pipeline
 * (`src/lib/sync/shopifyStore.ts`) : même normalisation, mêmes upserts,
 * mêmes clés d'unicité que la synchronisation live. Il n'écrit rien vers
 * Shopify.
 *
 * Usage :
 *   npx tsx scripts/ingest-shopify-bulk.ts \
 *     --domain 6mvti7-9g.myshopify.com --org <organizationId> \
 *     --products /tmp/products.jsonl [--orders /tmp/orders.jsonl] [--orders-window-days 365]
 *
 * Le fichier JSONL bulk contient un objet par ligne ; les objets enfants
 * (variantes, lignes de commande) portent `__parentId` = id du parent.
 */
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { recomputeStoreIntelligence } from "@/lib/intelligence/pipeline";
import { mapOrder, type ShopifyProductNode, type ShopifyVariantNode, type ShopifyOrderNode } from "@/lib/integrations/shopify";
import { storeProducts, storeOrders, rebuildSalesSnapshots } from "@/lib/sync/shopifyStore";
import type { NormalizeIssue } from "@/lib/validation/normalize";

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : null;
}

async function readJsonl(path: string): Promise<Array<Record<string, unknown>>> {
  const rows: Array<Record<string, unknown>> = [];
  const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    rows.push(JSON.parse(line) as Record<string, unknown>);
  }
  return rows;
}

function isGid(value: unknown, type: string): value is string {
  return typeof value === "string" && value.startsWith(`gid://shopify/${type}/`);
}

/** Reconstruit produits + variantes à partir des lignes plates du bulk. */
function assembleProducts(rows: Array<Record<string, unknown>>): { products: ShopifyProductNode[]; orphanVariants: number } {
  const byId = new Map<string, ShopifyProductNode>();
  let orphanVariants = 0;
  for (const r of rows) {
    if (isGid(r.id, "Product") && !r.__parentId) {
      byId.set(r.id, {
        id: r.id,
        handle: String(r.handle ?? ""),
        title: String(r.title ?? ""),
        status: String(r.status ?? "ACTIVE"),
        productType: (r.productType as string | null) ?? null,
        vendor: (r.vendor as string | null) ?? null,
        createdAt: String(r.createdAt ?? ""),
        featuredImage: (r.featuredImage as { url: string } | null) ?? null,
        variants: { nodes: [] },
      });
    }
  }
  for (const r of rows) {
    if (isGid(r.id, "ProductVariant") && typeof r.__parentId === "string") {
      const parent = byId.get(r.__parentId);
      if (!parent) {
        orphanVariants += 1;
        continue;
      }
      const v: ShopifyVariantNode = {
        id: r.id,
        title: String(r.title ?? ""),
        sku: (r.sku as string | null) ?? null,
        price: String(r.price ?? ""),
        compareAtPrice: (r.compareAtPrice as string | null) ?? null,
        inventoryQuantity: (r.inventoryQuantity as number | null) ?? null,
        inventoryItem: (r.inventoryItem as ShopifyVariantNode["inventoryItem"]) ?? null,
      };
      parent.variants.nodes.push(v);
    }
  }
  return { products: [...byId.values()], orphanVariants };
}

/** Reconstruit commandes + lignes à partir des lignes plates du bulk. */
function assembleOrders(rows: Array<Record<string, unknown>>): { orders: ShopifyOrderNode[]; orphanLines: number } {
  type RawOrderHead = Parameters<typeof mapOrder>[0];
  type RawLine = Parameters<typeof mapOrder>[1][number];
  const heads = new Map<string, RawOrderHead>();
  const lines = new Map<string, RawLine[]>();
  let orphanLines = 0;
  for (const r of rows) {
    if (isGid(r.id, "Order") && !r.__parentId) {
      heads.set(r.id, r as unknown as RawOrderHead);
      lines.set(r.id, []);
    }
  }
  for (const r of rows) {
    if (isGid(r.id, "LineItem") && typeof r.__parentId === "string") {
      const bucket = lines.get(r.__parentId);
      if (!bucket) {
        orphanLines += 1;
        continue;
      }
      bucket.push(r as unknown as RawLine);
    }
  }
  const orders = [...heads.entries()].map(([id, head]) => mapOrder(head, lines.get(id) ?? []));
  return { orders, orphanLines };
}

async function main() {
  const domain = arg("domain");
  const organizationId = arg("org");
  const productsPath = arg("products");
  const ordersPath = arg("orders");
  const ordersWindowDays = Number(arg("orders-window-days") ?? "365");
  if (!domain || !organizationId || !productsPath) {
    throw new Error("Arguments requis : --domain, --org, --products (et optionnellement --orders).");
  }

  // Boutique RÉELLE (isDemo: false), identifiée par son domaine — jamais la
  // boutique de démonstration. Créée si absente, réutilisée sinon (idempotent).
  let store = await prisma.store.findFirst({ where: { organizationId, domain } });
  if (!store) {
    store = await prisma.store.create({
      data: { organizationId, name: "OnDeal (boutique réelle)", domain, isDemo: false, currency: "EUR" },
    });
    console.log(`Boutique créée : ${store.id} (${domain})`);
  } else {
    console.log(`Boutique existante : ${store.id} (${domain})`);
  }
  if (store.isDemo) throw new Error("Refus : la boutique cible est une boutique de démonstration.");

  const run = await prisma.syncRun.create({ data: { storeId: store.id, provider: "SHOPIFY", status: "running", triggeredBy: "bulk_import" } });
  const started = Date.now();
  const issues: NormalizeIssue[] = [];
  const stats: Record<string, unknown> = { source: "bulk_operation_jsonl", productsFile: productsPath, ordersFile: ordersPath };

  try {
    const t0 = Date.now();
    const productRows = await readJsonl(productsPath);
    const { products, orphanVariants } = assembleProducts(productRows);
    stats.productsParse = { jsonlLines: productRows.length, products: products.length, orphanVariants, durationMs: Date.now() - t0 };
    console.log(`Produits lus : ${products.length} (lignes JSONL : ${productRows.length}, variantes orphelines : ${orphanVariants})`);

    const productStats = await storeProducts(store.id, store.currency, products, issues);
    stats.products = productStats;
    console.log(`Produits stockés : ${productStats.productsStored}, variantes : ${productStats.variantsStored} (avec unitCost : ${productStats.variantsWithUnitCost}, sans : ${productStats.variantsWithoutUnitCost}) en ${productStats.durationMs} ms`);

    if (ordersPath) {
      const t1 = Date.now();
      const orderRows = await readJsonl(ordersPath);
      const { orders, orphanLines } = assembleOrders(orderRows);
      stats.ordersParse = { jsonlLines: orderRows.length, orders: orders.length, orphanLines, windowDays: ordersWindowDays, durationMs: Date.now() - t1 };
      const orderStats = await storeOrders(store.id, orders);
      stats.orders = orderStats;
      stats.salesSnapshots = await rebuildSalesSnapshots(store.id, new Date(Date.now() - ordersWindowDays * 24 * 60 * 60 * 1000));
      console.log(`Commandes stockées : ${orderStats.ordersStored}, lignes : ${orderStats.linesStored} (avec variantId : ${orderStats.linesWithVariantId})`);
    }

    // Même distinction que la sync live : erreurs (données non stockées) vs
    // signalements qualité (données stockées telles quelles mais incohérentes).
    const qualityWarnings = Object.values(productStats.issueCountsByProblem).reduce((s, n) => s + n, 0);
    const issueCount = productStats.variantsRejected;
    stats.qualityWarnings = qualityWarnings;
    stats.hardErrors = issueCount;
    const t2 = Date.now();
    await recomputeStoreIntelligence(store.id);
    stats.intelligenceRecompute = { durationMs: Date.now() - t2 };
    stats.totalDurationMs = Date.now() - started;

    await prisma.syncRun.update({
      where: { id: run.id },
      data: {
        status: issueCount > 0 ? "partial" : "success",
        finishedAt: new Date(),
        itemsFetched: products.length,
        itemsStored: productStats.productsStored,
        errorCount: issueCount,
        errorSample: issues.length > 0 ? JSON.stringify(issues.slice(0, 20)) : null,
        statsJson: JSON.stringify(stats),
      },
    });
    await logAudit({
      storeId: store.id,
      actorType: "system",
      event: "sync.completed",
      message: `Import bulk Shopify (lecture seule) : ${productStats.productsStored} produits, ${productStats.variantsStored} variantes (${productStats.variantsWithUnitCost} avec coût unitaire Shopify), ${issueCount} erreur(s), ${qualityWarnings} signalement(s) qualité.`,
      meta: { syncRunId: run.id },
    });
    console.log(`SyncRun ${run.id} : terminé en ${stats.totalDurationMs} ms`);
    console.log(JSON.stringify(stats, null, 2));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.syncRun.update({
      where: { id: run.id },
      data: { status: "error", finishedAt: new Date(), errorCount: 1, errorSample: JSON.stringify([{ field: "bulk", problem: message }]), statsJson: JSON.stringify(stats) },
    });
    throw err;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
