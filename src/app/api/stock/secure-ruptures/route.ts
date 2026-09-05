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
// Traité par lots (voir BATCH_SIZE, même plafond que MAX_CJ_LOOKUPS_PER_EXECUTION
// utilisé pour "Vérifier le fournisseur" — limite de débit CJ réelle, 1
// requête/seconde documentée) : `nextOffset` dans la réponse permet au client
// de relancer pour le lot suivant, jusqu'à épuisement des ruptures.
export const maxDuration = 60;

const BATCH_SIZE = MAX_CJ_LOOKUPS_PER_EXECUTION;

const bodySchema = z
  .object({
    storeId: z.string().min(1).max(64),
    offset: z.number().int().min(0).max(1_000_000).optional(),
  })
  .strict();

export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Paramètres invalides." }, { status: 400 });
  const { storeId } = parsed.data;
  const offset = parsed.data.offset ?? 0;

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

  const cjResult = checkable.length > 0 ? await checkCjStock(storeId, checkable.map((v) => v.id)) : null;
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
