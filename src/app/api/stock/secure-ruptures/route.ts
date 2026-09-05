import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireStoreAccess, requireRole, WRITE_ROLES, AuthError } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { criticalTargetKey } from "@/lib/intelligence/actionKind";
import { checkCjStock, executeUnpublish, MAX_CJ_LOOKUPS_PER_EXECUTION, type CjCheckOutcome } from "@/app/api/actions/[id]/execute/route";

// CORRECTIF 05/09/2026 v3 — « Sécuriser mes ruptures » : version EN MASSE de
// "Vérifier le fournisseur" (jusqu'ici un clic par produit). Philosophie
// explicite de l'utilisateur : ne JAMAIS rester visiblement en rupture si un
// réassort est réellement impossible — un produit publié à 0 unité est une
// vente perdue et une mauvaise expérience client (voir recommendations.ts,
// "Produit actif publié sans stock").
//
// UN clic traite un lot de ruptures (voir BATCH_SIZE) :
//   1) vérifie chaque variante auprès de CJdropshipping et corrige le stock
//      Shopify quand le fournisseur en a réellement (réutilise checkCjStock,
//      donc EXACTEMENT la même logique et les mêmes garde-fous que le clic
//      individuel "Vérifier le fournisseur" — aucune logique dupliquée) ;
//   2) pour un produit ACTIVEMENT PUBLIÉ dont TOUTES les variantes sont
//      confirmées à 0 PARTOUT (boutique ET fournisseur — jamais sur une
//      simple absence de vérification), dépublie immédiatement (Shopify
//      passe en Draft) — décision explicite de l'utilisateur (voir la
//      question posée avant ce correctif) : dans le MÊME clic, pas une
//      liste séparée à reconfirmer.
//
// Choix décidé avec l'utilisateur avant ce correctif :
//   - déclenchement toujours par clic humain (jamais une tâche planifiée) ;
//   - la dépublication ne se déclenche QUE si CJ a été interrogé avec succès
//     ET a confirmé 0 pour CHAQUE variante du produit (`supplierStock === 0`
//     en base, jamais `null` — càd "pas encore vérifié" ne vaut JAMAIS
//     "confirmé indisponible") ; si CJ n'est pas connecté, aucune
//     dépublication n'a lieu, seulement la vérification/correction de stock.
//
// Traité par lots (voir ALLOWED_BATCH_SIZES) : `nextOffset` dans la réponse
// permet au client de relancer pour le lot suivant, jusqu'à épuisement des
// ruptures. CORRECTIF 05/09/2026 (même jour) — taille de lot rendue
// choisissable (20/50/100, demande explicite : "par 20 c'est un peu
// récurrent") plutôt que fixée à MAX_CJ_LOOKUPS_PER_EXECUTION (20). CJ
// n'autorisant qu'1 requête/seconde, `checkCjStockInChunks` ci-dessous
// découpe TOUJOURS en sous-lots d'au plus MAX_CJ_LOOKUPS_PER_EXECUTION
// variantes (même plafond, même pacing interne que "Vérifier le
// fournisseur", inchangé) et les enchaîne avec une pause de sécurité entre
// chaque — jamais un seul gros appel CJ, quelle que soit la taille de lot
// choisie ici. maxDuration relevé en conséquence (100 variantes × pacing CJ
// + jusqu'à 100 dépublications Shopify séquentielles dans le pire des cas).
export const maxDuration = 150;

const ALLOWED_BATCH_SIZES = [20, 50, 100] as const;
const DEFAULT_BATCH_SIZE: (typeof ALLOWED_BATCH_SIZES)[number] = 20;
/** Pause entre deux sous-lots CJ, en plus du pacing déjà appliqué ENTRE variantes à l'intérieur de checkCjStock — marge de sécurité supplémentaire à la frontière des sous-lots. */
const CHUNK_PAUSE_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Vérifie jusqu'à `variantIds.length` variantes auprès de CJ en les
 * découpant en sous-lots d'au plus MAX_CJ_LOOKUPS_PER_EXECUTION (le plafond
 * de checkCjStock, partagé avec "Vérifier le fournisseur" — jamais relevé
 * pour ne pas changer ce comportement déjà établi et testé). `null` dès le
 * premier sous-lot si CJ n'est pas connecté (les suivants ne le seraient pas
 * non plus) ; sinon agrège `detail`/`perVariant` de chaque sous-lot.
 */
async function checkCjStockInChunks(storeId: string, variantIds: string[]): Promise<{ detail: string; perVariant: CjCheckOutcome[] } | null> {
  if (variantIds.length === 0) return null;
  const details: string[] = [];
  const perVariant: CjCheckOutcome[] = [];
  let anyConnected = false;
  for (let i = 0; i < variantIds.length; i += MAX_CJ_LOOKUPS_PER_EXECUTION) {
    if (i > 0) await sleep(CHUNK_PAUSE_MS);
    const chunk = variantIds.slice(i, i + MAX_CJ_LOOKUPS_PER_EXECUTION);
    const res = await checkCjStock(storeId, chunk);
    if (res) {
      anyConnected = true;
      details.push(res.detail);
      perVariant.push(...res.perVariant);
    }
  }
  if (!anyConnected) return null;
  return { detail: details.join("\n\n"), perVariant };
}

const bodySchema = z
  .object({
    storeId: z.string().min(1).max(64),
    offset: z.number().int().min(0).max(1_000_000).optional(),
    batchSize: z.union([z.literal(20), z.literal(50), z.literal(100)]).optional(),
  })
  .strict();

export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Paramètres invalides." }, { status: 400 });
  const { storeId } = parsed.data;
  const offset = parsed.data.offset ?? 0;
  const BATCH_SIZE = parsed.data.batchSize ?? DEFAULT_BATCH_SIZE;

  let userId: string;
  try {
    const access = await requireStoreAccess(storeId);
    userId = access.userId;
    requireRole(access.role, WRITE_ROLES);
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }

  const shopifyIntegration = await prisma.integration.findUnique({ where: { storeId_provider: { storeId, provider: "SHOPIFY" } } });
  if (!shopifyIntegration || shopifyIntegration.status !== "CONNECTED") {
    return NextResponse.json(
      { error: "La sécurisation des ruptures nécessite Shopify connecté (Paramètres > Intégrations) — pas encore disponible pour WooCommerce/PrestaShop." },
      { status: 409 },
    );
  }

  const totalMatching = await prisma.variant.count({ where: { product: { storeId }, inventoryQuantity: 0 } });
  const batch = await prisma.variant.findMany({
    where: { product: { storeId }, inventoryQuantity: 0 },
    select: { id: true, sku: true, productId: true, title: true },
    orderBy: { id: "asc" },
    skip: offset,
    take: BATCH_SIZE,
  });

  if (batch.length === 0) {
    return NextResponse.json({
      ok: true,
      processed: 0,
      totalMatching,
      nextOffset: null,
      cjConnected: null,
      corrected: [],
      stillUnavailable: [],
      unpublished: [],
      unpublishFailed: [],
      skippedNoSku: 0,
      message: totalMatching === 0 ? "Aucune rupture de stock actuellement." : "Aucune rupture supplémentaire à ce décalage — toutes ont déjà été traitées.",
    });
  }

  const checkable = batch.filter((v) => v.sku !== null);
  const skippedNoSku = batch.length - checkable.length;
  const nextOffset = offset + batch.length < totalMatching ? offset + batch.length : null;

  // UNE ActionItem par lot (type review_supplier, SAFE — pas de mutation
  // Shopify propre à ce type, voir actionKind.ts) : trace ce lot de
  // vérification dans l'historique/audit exactement comme un clic individuel
  // "Vérifier le fournisseur", sans dupliquer une ActionItem par variante.
  const batchAction = await prisma.actionItem.create({
    data: {
      storeId,
      recommendationId: null,
      type: "review_supplier",
      sensitivity: "SAFE",
      status: "PENDING_VALIDATION",
      payloadJson: JSON.stringify({ variantIds: checkable.map((v) => v.id), bulk: "secure-ruptures" }),
      createdByUserId: userId,
    },
  });
  await logAudit({
    storeId,
    userId,
    actorType: "user",
    event: "action.prepared",
    message: `Sécurisation des ruptures : lot de ${batch.length} variante(s) (dont ${skippedNoSku} sans SKU, non vérifiable(s)).`,
    meta: { actionId: batchAction.id },
  });

  const cjResult = checkable.length > 0 ? await checkCjStockInChunks(storeId, checkable.map((v) => v.id)) : null;
  const cjConnected = cjResult !== null;

  await prisma.actionItem.update({
    where: { id: batchAction.id },
    data: { status: "EXECUTED", executedAt: new Date(), resultJson: JSON.stringify({ ok: true, kind: "manual_mission_completed", detail: cjResult?.detail ?? "CJdropshipping non connecté — vérification ignorée." }) },
  });
  await logAudit({
    storeId,
    userId,
    actorType: "user",
    event: "action.executed",
    message: cjConnected
      ? `Sécurisation des ruptures exécutée (${batchAction.id}) : ${cjResult!.detail.split("\n")[0]}`
      : "Sécurisation des ruptures : CJdropshipping non connecté, vérification ignorée pour ce lot.",
    meta: { actionId: batchAction.id },
  });

  const corrected: Array<{ variantId: string; title: string; newQuantity: number }> = [];
  const stillUnavailable: Array<{ variantId: string; title: string }> = [];
  if (cjResult) {
    const byId = new Map(checkable.map((v) => [v.id, v]));
    for (const outcome of cjResult.perVariant) {
      const v = byId.get(outcome.variantId);
      if (!v) continue;
      if (outcome.correctedToShopify && outcome.newQuantity !== null) {
        corrected.push({ variantId: v.id, title: v.title, newQuantity: outcome.newQuantity });
      } else if (outcome.supplierConfirmedZero) {
        stillUnavailable.push({ variantId: v.id, title: v.title });
      }
    }
  }

  // DÉPUBLICATION — jamais sans vérification CJ réussie sur ce lot (sinon on
  // ne SAIT rien de plus qu'avant, donc aucune décision supplémentaire).
  const unpublished: Array<{ productId: string; title: string }> = [];
  const unpublishFailed: Array<{ productId: string; title: string; error: string }> = [];

  if (cjConnected) {
    const uniqueProductIds = [...new Set(batch.map((v) => v.productId))];
    for (const productId of uniqueProductIds) {
      const product = await prisma.product.findFirst({ where: { id: productId, storeId }, include: { variants: true } });
      if (!product || product.status !== "active" || product.variants.length === 0) continue;

      // Éligible UNIQUEMENT si CHAQUE variante est à 0 en boutique ET
      // confirmée à 0 par le fournisseur (`supplierStock === 0`, jamais
      // `null` — une variante jamais vérifiée, ou dont CJ a du stock, bloque
      // la dépublication du produit entier).
      const allZeroEverywhere = product.variants.every((v) => v.inventoryQuantity === 0 && v.supplierStock === 0);
      if (!allZeroEverywhere) continue;

      const targetKey = criticalTargetKey("unpublish_product", { productId }, productId);
      const { action, resumed } = await prisma.$transaction(async (tx) => {
        if (targetKey) {
          const active = await tx.actionItem.findMany({
            where: { storeId, type: "unpublish_product", status: { in: ["PENDING_VALIDATION", "CONFIRMED"] } },
          });
          const conflicting = active.find((a) => {
            try {
              return criticalTargetKey(a.type, JSON.parse(a.payloadJson) as Record<string, unknown>, productId) === targetKey;
            } catch {
              return false;
            }
          });
          if (conflicting) return { action: conflicting, resumed: true };
        }
        const created = await tx.actionItem.create({
          data: { storeId, recommendationId: null, type: "unpublish_product", sensitivity: "SENSITIVE", status: "PENDING_VALIDATION", payloadJson: JSON.stringify({ productId }), createdByUserId: userId },
        });
        return { action: created, resumed: false };
      });

      if (resumed) continue; // déjà en cours (ex. dépublication individuelle lancée depuis Signaux) — pas de doublon.

      await logAudit({ storeId, userId, actorType: "user", event: "action.prepared", message: `Dépublication préparée (sécurisation des ruptures) : "${product.title}".`, meta: { actionId: action.id } });
      await prisma.actionItem.update({ where: { id: action.id }, data: { status: "CONFIRMED", confirmedAt: new Date() } });
      await logAudit({ storeId, userId, actorType: "user", event: "action.confirmed", message: `Dépublication confirmée automatiquement (produit confirmé sans aucun stock, boutique et fournisseur) : "${product.title}".`, meta: { actionId: action.id } });

      let result;
      try {
        result = await executeUnpublish(storeId, { productId });
      } catch (err) {
        result = { ok: false as const, kind: "error" as const, detail: err instanceof Error ? err.message : String(err) };
      }
      const finalStatus = result.ok ? "EXECUTED" : "FAILED";
      await prisma.actionItem.update({ where: { id: action.id }, data: { status: finalStatus, executedAt: new Date(), resultJson: JSON.stringify(result) } });
      await logAudit({
        storeId,
        userId,
        actorType: "user",
        event: result.ok ? "action.executed" : "action.failed",
        message: `Dépublication ${result.ok ? "exécutée" : "échouée"} (sécurisation des ruptures) : ${result.detail}`,
        meta: { actionId: action.id },
      });

      if (result.ok) unpublished.push({ productId, title: product.title });
      else unpublishFailed.push({ productId, title: product.title, error: result.detail });
    }
  }

  return NextResponse.json({
    ok: true,
    processed: batch.length,
    totalMatching,
    nextOffset,
    cjConnected,
    corrected,
    stillUnavailable,
    unpublished,
    unpublishFailed,
    skippedNoSku,
    detail: cjResult?.detail ?? null,
  });
}
