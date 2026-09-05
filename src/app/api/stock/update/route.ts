import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireStoreAccess, requireRole, WRITE_ROLES, AuthError } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { SENSITIVE_ACTION_TYPES } from "@/lib/intelligence/actionTypes";
import { criticalTargetKey } from "@/lib/intelligence/actionKind";
import { buildStockSnapshot } from "@/lib/intelligence/snapshot";
import { fetchCurrentStockFields } from "@/lib/intelligence/stockEvidence";
import { executeUpdateStock } from "@/app/api/actions/[id]/execute/route";

// CORRECTIF 05/09/2026 — modification directe du stock depuis la page
// /stock (édition en ligne), demandée explicitement après constat que la
// fonctionnalité était prévue dans le schéma (`ActionItem.type`,
// `SENSITIVE_ACTION_TYPES` contenaient déjà "update_stock") mais jamais
// câblée à une vraie mutation (voir execute/route.ts, actionKind.ts).
//
// Contrairement à une recommandation IA (`/api/actions` → `/confirm` →
// `/execute`, pensé pour un DÉLAI entre suggestion et décision humaine),
// une saisie manuelle est décidée par l'utilisateur au moment même où il
// clique "Enregistrer" — il n'y a pas de délai à protéger par un flux en
// plusieurs étapes. Cette route condense donc "proposer → confirmer →
// exécuter" en UN SEUL appel serveur, tout en créant une ActionItem réelle
// (recommendationId: null) et en journalisant chaque étape (audit), pour
// que ces corrections manuelles apparaissent dans l'historique des actions
// et dans /audit-log exactement comme une action confirmée classique.
//
// RÉSERVÉ À SHOPIFY (comme update_price/unpublish_product) : WooCommerce et
// PrestaShop n'ont aujourd'hui aucune mutation d'écriture (voir
// actionKind.ts) — refusé explicitement plutôt que d'échouer plus loin avec
// un message obscur.
const bodySchema = z
  .object({
    storeId: z.string().min(1).max(64),
    variantId: z.string().min(1).max(64),
    newQuantity: z.number().int().min(0).max(10_000_000),
    /** Quantité affichée côté client au moment de la saisie — détecte un écart AVANT même de créer une ActionItem (message plus clair qu'un rejet de snapshot après coup). */
    expectedCurrentQuantity: z.number().int().min(0).max(10_000_000).nullable(),
  })
  .strict();

export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Paramètres invalides." }, { status: 400 });
  const { storeId, variantId, newQuantity, expectedCurrentQuantity } = parsed.data;

  let userId: string;
  try {
    const access = await requireStoreAccess(storeId);
    userId = access.userId;
    requireRole(access.role, WRITE_ROLES);
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }

  const [variant, shopifyIntegration] = await Promise.all([
    prisma.variant.findFirst({ where: { id: variantId, product: { storeId } }, include: { product: true } }),
    prisma.integration.findUnique({ where: { storeId_provider: { storeId, provider: "SHOPIFY" } } }),
  ]);
  if (!variant) return NextResponse.json({ error: "Variante introuvable pour cette boutique." }, { status: 404 });
  if (!shopifyIntegration || shopifyIntegration.status !== "CONNECTED") {
    return NextResponse.json(
      { error: "La modification du stock nécessite Shopify connecté (Paramètres > Intégrations) — pas encore disponible pour WooCommerce/PrestaShop." },
      { status: 409 },
    );
  }
  if (expectedCurrentQuantity !== null && variant.inventoryQuantity !== expectedCurrentQuantity) {
    return NextResponse.json(
      {
        error: `Le stock affiché a changé depuis le chargement de la page (${expectedCurrentQuantity} → ${variant.inventoryQuantity ?? "inconnu"}) — rechargez avant de réessayer.`,
      },
      { status: 409 },
    );
  }

  const productId = variant.productId;
  const basePayload = { productId, variantId, newQuantity };
  const targetKey = criticalTargetKey("update_stock", basePayload, productId);
  const sensitivity = SENSITIVE_ACTION_TYPES.has("update_stock") ? "SENSITIVE" : "SAFE";

  // Même garantie anti-doublon que /api/actions (double clic, retry réseau) :
  // une seule ActionItem "update_stock" active par variante à la fois.
  const { action, resumed } = await prisma.$transaction(async (tx) => {
    if (targetKey) {
      const sameTypeActive = await tx.actionItem.findMany({
        where: { storeId, type: "update_stock", status: { in: ["PENDING_VALIDATION", "CONFIRMED"] } },
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
      data: { storeId, recommendationId: null, type: "update_stock", sensitivity, status: "PENDING_VALIDATION", payloadJson: JSON.stringify(basePayload), createdByUserId: userId },
    });
    return { action: created, resumed: false };
  });

  if (resumed) {
    return NextResponse.json(
      { error: "Une modification de stock est déjà en cours pour cette variante — patientez qu'elle se termine avant d'en lancer une autre." },
      { status: 409 },
    );
  }

  await logAudit({
    storeId,
    userId,
    actorType: "user",
    event: "action.prepared",
    message: `Action préparée : modification manuelle du stock (${variant.title}). En attente de validation.`,
    meta: { actionId: action.id },
  });

  // CONFIRMATION — snapshot capturé ici, à partir de données rechargées
  // fraîchement (même primitive que /api/actions/[id]/confirm), pour que
  // l'exécution qui suit immédiatement puisse détecter un changement
  // survenu entre la préparation et l'exécution (fenêtre très courte ici,
  // mais jamais supposée nulle — cohérence avec le reste du moteur).
  const currentFields = await fetchCurrentStockFields(productId, variantId);
  const payloadWithSnapshot = currentFields
    ? { ...basePayload, simulationSnapshot: buildStockSnapshot({ productId, variantId, candidateAddedUnits: null, fields: currentFields }) }
    : basePayload;

  await prisma.actionItem.update({
    where: { id: action.id },
    data: { status: "CONFIRMED", confirmedAt: new Date(), payloadJson: JSON.stringify(payloadWithSnapshot) },
  });
  await logAudit({
    storeId,
    userId,
    actorType: "user",
    event: "action.confirmed",
    message: `Action confirmée par l'utilisateur (type: update_stock).`,
    meta: { actionId: action.id },
  });

  let result;
  try {
    result = await executeUpdateStock(storeId, payloadWithSnapshot);
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
    message: `Action update_stock ${result.ok ? "exécutée" : "échouée"} (${result.kind}) : ${result.detail}`,
    meta: { actionId: action.id },
  });

  return NextResponse.json({ ...result, actionId: action.id });
}
