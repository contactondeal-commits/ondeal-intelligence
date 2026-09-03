import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireStoreAccess, AuthError } from "@/lib/auth";
import { decryptJson } from "@/lib/crypto";
import { logAudit } from "@/lib/audit";
import { updateVariantPrice, updateProductStatus, type ShopifyCredentials } from "@/lib/integrations/shopify";

// PHASE 13 — Exécution. Séquence obligatoire :
// IA → recommandation → explication → validation humaine (CONFIRMED) → exécution → vérification.
// Les actions SENSITIVE ne s'exécutent JAMAIS avant confirmation explicite.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const action = await prisma.actionItem.findUnique({ where: { id } });
  if (!action) return NextResponse.json({ error: "Action introuvable." }, { status: 404 });

  let userId: string;
  try {
    ({ userId } = await requireStoreAccess(action.storeId));
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }

  if (action.sensitivity === "SENSITIVE" && action.status !== "CONFIRMED") {
    return NextResponse.json(
      { error: "Cette action est sensible et doit être confirmée explicitement avant exécution." },
      { status: 409 },
    );
  }
  if (action.sensitivity === "SAFE" && !["PENDING_VALIDATION", "CONFIRMED"].includes(action.status)) {
    return NextResponse.json({ error: `Action déjà au statut ${action.status}.` }, { status: 409 });
  }

  const payload = JSON.parse(action.payloadJson) as Record<string, unknown>;
  let result: { ok: boolean; detail: string; verification?: string };

  try {
    switch (action.type) {
      case "update_price":
        result = await executeUpdatePrice(action.storeId, payload);
        break;
      case "unpublish_product":
        result = await executeUnpublish(action.storeId, payload);
        break;
      case "review_supplier":
      case "request_reviews":
      case "promote_product":
      case "edit_product_data":
        // Actions informationnelles : pas de mutation API disponible pour
        // ces tâches (relèvent d'une décision commerciale/fournisseur
        // externe). "Exécuter" ici documente que l'action a été prise en
        // charge par l'utilisateur — jamais simulé comme une vraie mutation.
        result = { ok: true, detail: "Action marquée comme prise en charge par l'utilisateur (aucune modification automatique de la boutique pour ce type d'action)." };
        break;
      default:
        result = { ok: false, detail: `Type d'action non pris en charge par le moteur d'exécution : ${action.type}` };
    }
  } catch (err) {
    result = { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }

  const finalStatus = result.ok ? "EXECUTED" : "FAILED";

  await prisma.actionItem.update({
    where: { id },
    data: { status: finalStatus, executedAt: new Date(), resultJson: JSON.stringify(result) },
  });

  if (action.recommendationId && result.ok) {
    await prisma.recommendation.update({ where: { id: action.recommendationId }, data: { status: "ACTIONED" } });
  }

  await logAudit({
    storeId: action.storeId,
    userId,
    actorType: "user",
    event: result.ok ? "action.executed" : "action.failed",
    message: `Action ${action.type} ${result.ok ? "exécutée" : "échouée"} : ${result.detail}${result.verification ? " — Vérification : " + result.verification : ""}`,
    meta: { actionId: id },
  });

  return NextResponse.json({ ok: result.ok, detail: result.detail, verification: result.verification });
}

async function getShopifyCreds(storeId: string): Promise<ShopifyCredentials> {
  const integration = await prisma.integration.findUnique({ where: { storeId_provider: { storeId, provider: "SHOPIFY" } } });
  if (!integration || integration.status !== "CONNECTED" || !integration.encryptedCredentials) {
    throw new Error("Shopify n'est pas connecté pour cette boutique — impossible d'exécuter cette action.");
  }
  return decryptJson<ShopifyCredentials>(integration.encryptedCredentials);
}

async function executeUpdatePrice(storeId: string, payload: Record<string, unknown>) {
  const productId = payload.productId as string;
  const variantId = payload.variantId as string;
  const newPrice = Number(payload.newPrice);
  if (!productId || !variantId) throw new Error("Produit/variante manquant dans l'action.");
  if (!newPrice || Number.isNaN(newPrice) || newPrice <= 0) {
    throw new Error("Aucun nouveau prix valide fourni — saisissez un prix avant de confirmer cette action.");
  }

  const [product, variant] = await Promise.all([
    prisma.product.findUnique({ where: { id: productId } }),
    prisma.variant.findUnique({ where: { id: variantId } }),
  ]);
  if (!product || !variant) throw new Error("Produit/variante introuvable en base.");

  const creds = await getShopifyCreds(storeId);
  const res = await updateVariantPrice(creds, product.shopifyProductId, variant.shopifyVariantId, newPrice);
  if (!res.ok) throw new Error(res.error);

  // VÉRIFICATION : on relit la valeur retournée par Shopify (pas seulement
  // "pas d'erreur") et on met à jour notre copie locale pour rester cohérent
  // jusqu'à la prochaine synchronisation complète.
  await prisma.variant.update({ where: { id: variantId }, data: { price: Number(res.price) } });

  return {
    ok: true,
    detail: `Prix mis à jour sur Shopify : ${res.price} €.`,
    verification: `Confirmé par la réponse Shopify (nouveau prix : ${res.price} €).`,
  };
}

async function executeUnpublish(storeId: string, payload: Record<string, unknown>) {
  const productId = payload.productId as string;
  if (!productId) throw new Error("Produit manquant dans l'action.");
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) throw new Error("Produit introuvable en base.");

  const creds = await getShopifyCreds(storeId);
  const res = await updateProductStatus(creds, product.shopifyProductId, "DRAFT");
  if (!res.ok) throw new Error(res.error);

  await prisma.product.update({ where: { id: productId }, data: { status: res.status.toLowerCase() } });

  return {
    ok: true,
    detail: "Produit dépublié (statut Draft) sur Shopify.",
    verification: `Confirmé par la réponse Shopify (statut : ${res.status}).`,
  };
}
