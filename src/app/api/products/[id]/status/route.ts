import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireStoreAccess, requireRole, WRITE_ROLES, AuthError } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { SENSITIVE_ACTION_TYPES } from "@/lib/intelligence/actionTypes";
import { criticalTargetKey } from "@/lib/intelligence/actionKind";
import { executeSetProductStatus } from "@/app/api/actions/[id]/execute/route";

// CORRECTIF 05/09/2026 v4 — "Archiver / Mettre en brouillon / Republier"
// directement depuis la fiche produit (Product Intelligence), demandé après
// constat (capture d'écran utilisateur) que ni l'app ni l'assistant IA
// n'offraient AUCUN moyen d'archiver ou de retirer un produit de la vente
// sans quitter OnDeal pour Shopify. Même architecture que
// /api/stock/update : une saisie manuelle est décidée par l'utilisateur au
// moment même du clic — pas de délai à protéger par un flux en plusieurs
// étapes — donc "proposer → confirmer → exécuter" est condensé en UN SEUL
// appel serveur, tout en créant une vraie ActionItem (recommendationId:
// null, type "set_product_status") auditée exactement comme une action
// confirmée classique (visible dans /audit-log).
//
// RÉSERVÉ À SHOPIFY : WooCommerce et PrestaShop n'ont aujourd'hui aucune
// mutation d'écriture (voir actionKind.ts) — refusé explicitement plutôt
// que d'échouer plus loin avec un message obscur.
const bodySchema = z
  .object({
    storeId: z.string().min(1).max(64),
    targetStatus: z.enum(["ACTIVE", "DRAFT", "ARCHIVED"]),
    /** Statut affiché côté client au moment du clic — détecte un écart AVANT de créer une ActionItem (cohérent avec expectedCurrentQuantity de /api/stock/update). */
    expectedCurrentStatus: z.string().nullable(),
  })
  .strict();

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: productId } = await params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Paramètres invalides." }, { status: 400 });
  const { storeId, targetStatus, expectedCurrentStatus } = parsed.data;

  let userId: string;
  try {
    const access = await requireStoreAccess(storeId);
    userId = access.userId;
    requireRole(access.role, WRITE_ROLES);
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }

  const [product, shopifyIntegration] = await Promise.all([
    prisma.product.findFirst({ where: { id: productId, storeId } }),
    prisma.integration.findUnique({ where: { storeId_provider: { storeId, provider: "SHOPIFY" } } }),
  ]);
  if (!product) return NextResponse.json({ error: "Produit introuvable pour cette boutique." }, { status: 404 });
  if (!shopifyIntegration || shopifyIntegration.status !== "CONNECTED") {
    return NextResponse.json(
      { error: "Cette action nécessite Shopify connecté (Paramètres > Intégrations) — pas encore disponible pour WooCommerce/PrestaShop." },
      { status: 409 },
    );
  }
  if (expectedCurrentStatus !== null && product.status !== expectedCurrentStatus) {
    return NextResponse.json(
      { error: `Le statut affiché a changé depuis le chargement de la page (${expectedCurrentStatus} → ${product.status}) — rechargez avant de réessayer.` },
      { status: 409 },
    );
  }
  if (product.status === targetStatus.toLowerCase()) {
    return NextResponse.json({ error: `Ce produit est déjà au statut « ${targetStatus.toLowerCase()} ».` }, { status: 409 });
  }

  const basePayload = { productId, targetStatus };
  const targetKey = criticalTargetKey("set_product_status", basePayload, productId);
  const sensitivity = SENSITIVE_ACTION_TYPES.has("set_product_status") ? "SENSITIVE" : "SAFE";

  // Même garantie anti-doublon que /api/stock/update et /api/actions : une
  // seule ActionItem "set_product_status" active par produit à la fois.
  const { action, resumed } = await prisma.$transaction(async (tx) => {
    if (targetKey) {
      const sameTypeActive = await tx.actionItem.findMany({
        where: { storeId, type: "set_product_status", status: { in: ["PENDING_VALIDATION", "CONFIRMED"] } },
      });
      const conflicting = sameTypeActive.find((a) => {
        try {
          return criticalTargetKey(a.type, JSON.parse(a.payloadJson) as Record<string, unknown>, productId) === targetKey;
        } catch {
          return false;
        }
      });
      if (conflicting) return { action: conflicting, resumed: true };
    }
    const created = await tx.actionItem.create({
      data: {
        storeId,
        recommendationId: null,
        type: "set_product_status",
        sensitivity,
        status: "PENDING_VALIDATION",
        payloadJson: JSON.stringify(basePayload),
        createdByUserId: userId,
      },
    });
    return { action: created, resumed: false };
  });

  if (resumed) {
    return NextResponse.json(
      { error: "Un changement de statut est déjà en cours pour ce produit — patientez qu'il se termine avant d'en lancer un autre." },
      { status: 409 },
    );
  }

  await logAudit({
    storeId,
    userId,
    actorType: "user",
    event: "action.prepared",
    message: `Action préparée : changement de statut manuel (${product.title} → ${targetStatus}). En attente de validation.`,
    meta: { actionId: action.id },
  });

  await prisma.actionItem.update({
    where: { id: action.id },
    data: { status: "CONFIRMED", confirmedAt: new Date() },
  });
  await logAudit({
    storeId,
    userId,
    actorType: "user",
    event: "action.confirmed",
    message: `Action confirmée par l'utilisateur (type: set_product_status).`,
    meta: { actionId: action.id },
  });

  let result;
  try {
    result = await executeSetProductStatus(storeId, basePayload);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    result = { ok: false as const, kind: "error" as const, detail: message };
  }

  const finalStatus = result.ok ? "EXECUTED" : "FAILED";
  await prisma.actionItem.update({
    where: { id: action.id },
    data: { status: finalStatus, executedAt: new Date(), resultJson: JSON.stringify(result) },
  });
  await logAudit({
    storeId,
    userId,
    actorType: "user",
    event: result.ok ? "action.executed" : "action.failed",
    message: `Action set_product_status ${result.ok ? "exécutée" : "échouée"} (${result.kind}) : ${result.detail}`,
    meta: { actionId: action.id },
  });

  return NextResponse.json({ ...result, actionId: action.id });
}

