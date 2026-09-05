import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireStoreAccess, AuthError } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { analyzeStock, queryStock, type StockInput } from "@/lib/intelligence/stock";
import { salesWindowStart, unitsSoldInWindow } from "@/lib/intelligence/salesWindow";
import { POST as updateSingleStock } from "@/app/api/stock/update/route";

// CORRECTIF 05/09/2026 (lot 4, puis extension "taille de page" le même jour)
// — modification de stock EN MASSE, demandée depuis le tout premier message
// de la journée : "sélectionner une page de produits, une série ou une
// catégorie pour appliquer un changement de stock" (valeur arbitraire, PAS
// liée aux ruptures — voir secure-ruptures pour ce cas déjà couvert
// séparément).
//
// Deux modes de sélection, une seule règle appliquée à chaque variante :
//   - "selected" : liste explicite de variantId cochées manuellement dans le
//     tableau /stock (plafond MAX_BULK_ITEMS — voir /lib/pagination.ts, la
//     page /stock permet de choisir 50/100/150 lignes, donc "toute une page"
//     tient toujours en un seul lot quel que soit le choix).
//   - "filtered" : "toutes les variantes correspondant aux filtres actuels"
//     (statut/recherche/CATÉGORIE/tri) — traité par lots de MAX_BULK_ITEMS
//     avec `nextOffset`, même pipeline `analyzeStock`+`queryStock` QUE la
//     page /stock (voir stock.ts) pour garantir que "ce que vous voyez est
//     ce qui sera modifié". "Catégorie" = Product.productType (proxy — OnDeal
//     ne synchronise pas les Collections Shopify aujourd'hui).
//
// Règle : valeur absolue (même quantité partout) ou ajustement relatif
// (+/- N, jamais négatif après application — voir computeNewQuantity).
//
// AUCUNE logique de mutation dupliquée : chaque variante passe par le POST
// exporté de /api/stock/update/route.ts (garde-fous Shopify connecté,
// anti-doublon par ActionItem, audit, exécution réelle) — exactement le
// même pattern que /api/actions/bulk réutilisant /api/actions. Séquentiel,
// volontairement : chaque appel repasse par sa propre transaction
// d'idempotence, la paralléliser n'apporterait rien ici.
//
// MAX_BULK_ITEMS = 150 pour couvrir la plus grande taille de page proposée
// sur /stock (50/100/150 — voir StockTable.tsx). maxDuration relevé à 300s
// (plan Vercel Pro, même plafond que cron/sync) : jusqu'à 150 écritures
// Shopify séquentielles dans le pire des cas, contre 50 auparavant.
export const maxDuration = 300;

const MAX_BULK_ITEMS = 150;

const ruleSchema = z.union([
  z.object({ kind: z.literal("absolute"), value: z.number().int().min(0).max(10_000_000) }),
  z.object({ kind: z.literal("delta"), value: z.number().int().min(-10_000_000).max(10_000_000) }),
]);

const bodySchema = z
  .object({
    storeId: z.string().min(1).max(64),
    rule: ruleSchema,
    mode: z.enum(["selected", "filtered"]),
    // mode "selected"
    items: z
      .array(z.object({ variantId: z.string().min(1).max(64), expectedCurrentQuantity: z.number().int().min(0).max(10_000_000).nullable() }))
      .max(MAX_BULK_ITEMS)
      .optional(),
    // mode "filtered"
    filters: z
      .object({
        status: z.string().max(64).optional(),
        q: z.string().max(200).optional(),
        category: z.string().max(200).optional(),
        sort: z.string().max(64).optional(),
      })
      .optional(),
    offset: z.number().int().min(0).max(1_000_000).optional(),
  })
  .strict();

type Rule = z.infer<typeof ruleSchema>;
type Target = { variantId: string; title: string; expectedCurrentQuantity: number | null };

/** null = ajustement relatif demandé mais stock actuel inconnu → impossible à calculer sans deviner. */
function computeNewQuantity(rule: Rule, current: number | null): number | null {
  if (rule.kind === "absolute") return rule.value;
  if (current === null) return null;
  return Math.max(0, Math.min(10_000_000, current + rule.value));
}

/**
 * Recalcule EXACTEMENT le même pipeline que la page /stock (voir
 * src/app/(app)/stock/page.tsx) : mêmes requêtes, mêmes fonctions pures
 * (analyzeStock, queryStock). Toute divergence romprait la promesse "ce que
 * vous voyez à l'écran est ce qui sera modifié" pour le mode "filtered".
 */
async function computeFilteredMatches(storeId: string, filters: { status?: string; q?: string; category?: string; sort?: string }) {
  const [products, variants, salesInWindow, salesHistory] = await Promise.all([
    prisma.product.findMany({ where: { storeId }, select: { id: true, title: true, productType: true, _count: { select: { variants: true } } } }),
    prisma.variant.findMany({
      where: { product: { storeId } },
      select: { id: true, productId: true, title: true, sku: true, inventoryQuantity: true, supplierStock: true, updatedAt: true },
    }),
    prisma.salesSnapshot.groupBy({ by: ["productId"], where: { product: { storeId }, date: { gte: salesWindowStart() } }, _sum: { unitsSold: true } }),
    prisma.salesSnapshot.groupBy({ by: ["productId"], where: { product: { storeId } }, _count: true }),
  ]);
  const productById = new Map(products.map((p) => [p.id, p]));
  const unitsByProduct = new Map(salesInWindow.map((s) => [s.productId, s._sum.unitsSold ?? 0]));
  const historyByProduct = new Set(salesHistory.map((s) => s.productId));

  const analyses = variants.map((v) => {
    const p = productById.get(v.productId);
    const units = unitsByProduct.has(v.productId) ? [{ unitsSold: unitsByProduct.get(v.productId)! }] : [];
    const input: StockInput = {
      productId: v.productId,
      variantId: v.id,
      title: p ? (p._count.variants > 1 ? `${p.title} — ${v.title}` : p.title) : v.title,
      sku: v.sku,
      storeStock: v.inventoryQuantity,
      supplierStock: v.supplierStock,
      unitsSoldLast30Days: unitsSoldInWindow(units, historyByProduct.has(v.productId)),
      lastSyncedAt: v.updatedAt.toISOString(),
      productType: p?.productType ?? null,
    };
    return analyzeStock(input);
  });

  return queryStock(analyses, { status: filters.status ?? "all", q: filters.q, category: filters.category, sort: filters.sort ?? "critical" });
}

export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Paramètres invalides." }, { status: 400 });
  const { storeId, rule, mode } = parsed.data;

  let userId: string;
  try {
    ({ userId } = await requireStoreAccess(storeId));
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }

  let targets: Target[];
  let totalMatching: number;
  let nextOffset: number | null;

  if (mode === "selected") {
    const items = parsed.data.items ?? [];
    if (items.length === 0) return NextResponse.json({ error: "Aucune variante sélectionnée." }, { status: 400 });

    const variants = await prisma.variant.findMany({
      where: { id: { in: items.map((i) => i.variantId) }, product: { storeId } },
      select: { id: true, title: true, product: { select: { title: true } } },
    });

    const byId = new Map(variants.map((v) => [v.id, v]));
    targets = items
      .filter((i) => byId.has(i.variantId))
      .map((i) => {
        const v = byId.get(i.variantId)!;
        return { variantId: i.variantId, title: `${v.product.title} — ${v.title}`, expectedCurrentQuantity: i.expectedCurrentQuantity };
      });
    totalMatching = targets.length;
    nextOffset = null;
  } else {
    const offset = parsed.data.offset ?? 0;
    const filters = parsed.data.filters ?? {};
    const matching = await computeFilteredMatches(storeId, filters);
    totalMatching = matching.length;
    const batch = matching.slice(offset, offset + MAX_BULK_ITEMS);
    nextOffset = offset + MAX_BULK_ITEMS < totalMatching ? offset + MAX_BULK_ITEMS : null;
    targets = batch.map((a) => ({ variantId: a.variantId, title: a.title, expectedCurrentQuantity: a.storeStock }));
  }

  if (targets.length === 0) {
    return NextResponse.json({ ok: true, processed: 0, totalMatching, nextOffset, applied: [], skipped: [] });
  }

  const applied: Array<{ variantId: string; title: string; newQuantity: number }> = [];
  const skipped: Array<{ variantId: string; title: string; reason: string }> = [];

  for (const t of targets) {
    const newQuantity = computeNewQuantity(rule, t.expectedCurrentQuantity);
    if (newQuantity === null) {
      skipped.push({ variantId: t.variantId, title: t.title, reason: "Stock actuel inconnu — impossible d'appliquer un ajustement relatif sans le deviner." });
      continue;
    }
    const fakeReq = new NextRequest("http://internal.ondeal/api/stock/update", {
      method: "POST",
      body: JSON.stringify({ storeId, variantId: t.variantId, newQuantity, expectedCurrentQuantity: t.expectedCurrentQuantity }),
    });
    const res = await updateSingleStock(fakeReq);
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || !data.ok) {
      skipped.push({ variantId: t.variantId, title: t.title, reason: data.error ?? "Échec de la mise à jour." });
      continue;
    }
    applied.push({ variantId: t.variantId, title: t.title, newQuantity });
  }

  await logAudit({
    storeId,
    userId,
    actorType: "user",
    event: "action.bulk_stock_update",
    message: `Modification de stock en masse (${mode === "selected" ? "sélection manuelle" : "filtre en cours"}) : ${applied.length}/${targets.length} variante(s) mise(s) à jour (règle ${rule.kind === "absolute" ? `= ${rule.value}` : `${rule.value >= 0 ? "+" : ""}${rule.value}`}).`,
    meta: { mode, applied: applied.length, skipped: skipped.length, totalMatching },
  });

  return NextResponse.json({ ok: true, processed: targets.length, totalMatching, nextOffset, applied, skipped });
}
