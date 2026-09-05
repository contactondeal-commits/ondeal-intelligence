import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireStoreAccess, requireRole, WRITE_ROLES, AuthError } from "@/lib/auth";

const bodySchema = z
  .object({
    params: z
      .object({
        newPrice: z.number().positive().max(1_000_000).optional(),
        newQuantity: z.number().int().min(0).max(10_000_000).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
import { logAudit } from "@/lib/audit";
import { buildPriceSnapshot, buildStockSnapshot } from "@/lib/intelligence/snapshot";
import { resolveCostInputs } from "@/lib/intelligence/costs";
import { buildPricePrediction } from "@/lib/intelligence/prediction";
import { fetchCurrentStockFields } from "@/lib/intelligence/stockEvidence";

// PHASE 13 — étape de validation humaine explicite, distincte de l'exécution.
// "Cette action va modifier votre boutique." → Annuler / Confirmer.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const action = await prisma.actionItem.findUnique({ where: { id } });
  if (!action) return NextResponse.json({ error: "Action introuvable." }, { status: 404 });

  // SÉCURITÉ (04/09/2026) — seuls les paramètres saisis par l'humain sont
  // acceptés (liste blanche stricte). Les identifiants produit/variante et
  // les snapshots viennent EXCLUSIVEMENT du payload serveur : un client ne
  // peut ni les remplacer ni cibler une donnée d'une autre boutique.
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Paramètres de validation invalides." }, { status: 400 });
  const humanParams = parsed.data.params ?? {};

  try {
    const { userId, role } = await requireStoreAccess(action.storeId);
    requireRole(role, WRITE_ROLES);
    if (action.status !== "PENDING_VALIDATION") {
      return NextResponse.json({ error: `Action déjà au statut ${action.status}.` }, { status: 409 });
    }

    // Pour les actions de type "update_price" / "update_stock", le nouveau
    // prix/stock est saisi par l'humain au moment de la validation — jamais
    // décidé automatiquement par le moteur de recommandations.
    const existingPayload = JSON.parse(action.payloadJson) as Record<string, unknown>;
    let mergedPayload: Record<string, unknown> = { ...existingPayload, ...humanParams };

    // SNAPSHOT DE SIMULATION (priorité absolue) — capturé ICI, côté serveur,
    // à partir de données rechargées fraîchement en base (jamais celles
    // envoyées par le client, qui peuvent dater de l'ouverture de la page).
    // C'est ce snapshot que /api/actions/[id]/execute comparera aux données
    // réelles juste avant la mutation Shopify, pour refuser d'exécuter une
    // décision calculée sur une donnée devenue obsolète entre-temps.
    if (action.type === "update_price") {
      const productId = mergedPayload.productId as string | undefined;
      const variantId = mergedPayload.variantId as string | undefined;
      const newPrice = Number(mergedPayload.newPrice);
      if (productId && variantId && Number.isFinite(newPrice) && newPrice > 0) {
        const [variant, costAssumption, storeDefaults] = await Promise.all([
          prisma.variant.findUnique({ where: { id: variantId }, include: { product: { select: { storeId: true } } } }),
          prisma.costAssumption.findUnique({ where: { productId } }),
          prisma.store.findUnique({ where: { id: action.storeId }, select: { defaultShippingCost: true, defaultPaymentFeesRate: true } }),
        ]);
        // Isolation multi-boutiques : la variante ciblée doit appartenir à la
        // boutique de l'action (défense en profondeur, en plus de la liste blanche).
        if (variant && (variant.product.storeId !== action.storeId || variant.productId !== productId)) {
          return NextResponse.json({ error: "Variante hors périmètre de cette boutique." }, { status: 403 });
        }
        if (variant) {
          // Coût réel Shopify prioritaire, hypothèses OnDeal en repli (costs.ts)
          // — même résolution que l'analyse et que l'exécution.
          const costs = resolveCostInputs(variant, costAssumption, storeDefaults);
          const fields = {
            currentPrice: variant.price,
            supplierCost: costs.supplierCost,
            shippingCost: costs.shippingCost,
            paymentFeesRate: costs.paymentFeesRate,
            otherFixedCost: costs.otherFixedCost,
          };
          mergedPayload = {
            ...mergedPayload,
            simulationSnapshot: buildPriceSnapshot({ productId, variantId, candidateValue: newPrice, fields }),
            // PREDICTION SNAPSHOT — exactement ce qu'OnDeal prédit au moment
            // de la validation humaine (mêmes formules que l'analyse), pour
            // pouvoir comparer plus tard prédiction et résultat.
            prediction: buildPricePrediction({
              variantId,
              productId,
              currentPrice: variant.price,
              newPrice,
              costs,
              title: String(mergedPayload.title ?? ""),
            }),
          };
        }
      }
    }

    // Même principe que update_price, avec la preuve stock/vélocité au lieu
    // de prix/coûts (correctif 05/09/2026 — voir execute/route.ts).
    if (action.type === "update_stock") {
      const productId = mergedPayload.productId as string | undefined;
      const variantId = mergedPayload.variantId as string | undefined;
      const newQuantity = Number(mergedPayload.newQuantity);
      if (productId && variantId && Number.isFinite(newQuantity) && newQuantity >= 0 && Number.isInteger(newQuantity)) {
        const variant = await prisma.variant.findUnique({ where: { id: variantId }, include: { product: { select: { storeId: true } } } });
        if (variant && (variant.product.storeId !== action.storeId || variant.productId !== productId)) {
          return NextResponse.json({ error: "Variante hors périmètre de cette boutique." }, { status: 403 });
        }
        if (variant) {
          const currentFields = await fetchCurrentStockFields(productId, variantId);
          if (currentFields) {
            mergedPayload = {
              ...mergedPayload,
              simulationSnapshot: buildStockSnapshot({ productId, variantId, candidateAddedUnits: null, fields: currentFields }),
            };
          }
        }
      }
    }

    const updated = await prisma.actionItem.update({
      where: { id },
      data: { status: "CONFIRMED", confirmedAt: new Date(), payloadJson: JSON.stringify(mergedPayload) },
    });
    await logAudit({
      storeId: action.storeId,
      userId,
      actorType: "user",
      event: "action.confirmed",
      message: `Action confirmée par l'utilisateur (type: ${action.type}).`,
      meta: { actionId: id },
    });
    return NextResponse.json({ ok: true, action: updated });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }
}
