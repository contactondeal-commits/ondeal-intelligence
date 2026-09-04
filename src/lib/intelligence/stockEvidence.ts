import { prisma } from "@/lib/db";
import { analyzeStock } from "@/lib/intelligence/stock";
import type { StockSnapshotFields } from "@/lib/intelligence/snapshot";
import { salesWindowStart, unitsSoldInWindow } from "@/lib/intelligence/salesWindow";

/**
 * Relit les données de stock RÉELLES actuelles pour une variante et
 * recalcule la vélocité via `analyzeStock` — exactement la même primitive et
 * la même source (agrégat `SalesSnapshot` sur 30 jours) que celle utilisée
 * par le pipeline de recommandations (`recomputeStoreIntelligence`), pour
 * que "donnée au moment du snapshot" et "donnée réelle actuelle" soient
 * calculées de façon strictement identique. Aucune nouvelle formule.
 *
 * Retourne `null` si la variante n'existe plus (supprimée depuis la
 * préparation de la mission) — l'appelant décide alors s'il y a quelque
 * chose à protéger ou non.
 */
export async function fetchCurrentStockFields(productId: string, variantId: string): Promise<StockSnapshotFields | null> {
  const [variant, salesSnapshots] = await Promise.all([
    prisma.variant.findUnique({ where: { id: variantId } }),
    prisma.salesSnapshot.findMany({ where: { productId }, orderBy: { date: "desc" }, take: 30 }),
  ]);
  if (!variant) return null;

  const unitsSoldLast30Days = salesSnapshots.length > 0 ? salesSnapshots.reduce((sum, s) => sum + s.unitsSold, 0) : null;

  const analysis = analyzeStock({
    productId,
    variantId,
    title: "",
    sku: variant.sku,
    storeStock: variant.inventoryQuantity,
    supplierStock: variant.supplierStock,
    unitsSoldLast30Days,
    lastSyncedAt: variant.updatedAt.toISOString(),
  });

  return { currentStock: analysis.storeStock, dailyVelocity: analysis.dailyVelocity };
}

/**
 * Version multi-variante de `fetchCurrentStockFields`, pour une mission
 * "review_supplier" agrégée par produit (voir recommendations.ts et
 * snapshot.ts). Une seule requête `SalesSnapshot` (le produit entier — les
 * ventes ne sont PAS ventilées par variante dans ce modèle de données, voir
 * schema.prisma) partagée par toutes les variantes, comme le fait déjà
 * `recomputeStoreIntelligence` pour chaque variante individuellement.
 * Retourne une Map indexée par variantId ; une variante supprimée depuis
 * n'apparaît simplement pas dans la Map (l'appelant sait déjà ne rien avoir
 * à comparer pour elle).
 */
export async function fetchCurrentStockFieldsMulti(productId: string, variantIds: string[]): Promise<Map<string, StockSnapshotFields>> {
  const [variants, salesSnapshots] = await Promise.all([
    prisma.variant.findMany({ where: { id: { in: variantIds } } }),
    prisma.salesSnapshot.findMany({ where: { productId }, orderBy: { date: "desc" }, take: 30 }),
  ]);

  const unitsSoldLast30Days = salesSnapshots.length > 0 ? salesSnapshots.reduce((sum, s) => sum + s.unitsSold, 0) : null;

  const result = new Map<string, StockSnapshotFields>();
  for (const variant of variants) {
    const analysis = analyzeStock({
      productId,
      variantId: variant.id,
      title: "",
      sku: variant.sku,
      storeStock: variant.inventoryQuantity,
      supplierStock: variant.supplierStock,
      unitsSoldLast30Days,
      lastSyncedAt: variant.updatedAt.toISOString(),
    });
    result.set(variant.id, { currentStock: analysis.storeStock, dailyVelocity: analysis.dailyVelocity });
  }
  return result;
}
