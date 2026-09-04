import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireStoreAccess, AuthError } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { resolveCostInputs } from "@/lib/intelligence/costs";
import { computeBulkPrice, type BulkPricingRule } from "@/lib/intelligence/bulkPricing";
import { POST as createSingleAction } from "@/app/api/actions/route";

const MAX_BULK_ITEMS = 50;

/**
 * Chantier 3 — Actions groupées, étape 1/2 : préparation.
 *
 * STRICTEMENT additif : ne modifie ni ne réimplémente RIEN du moteur
 * d'actions existant (Phase 3, gelée). Pour chaque recommandation, appelle
 * directement — en mémoire, dans le même process, même requête HTTP — la
 * fonction POST exportée par /api/actions/route.ts, EXACTEMENT comme un
 * clic "Simuler → Décider" individuel le ferait un par un. Aucune logique
 * de création d'ActionItem dupliquée ici. L'authentification fonctionne
 * normalement : `cookies()` (next/headers) lit le contexte de LA requête
 * HTTP réelle en cours, pas l'objet Request qu'on construit ci-dessous —
 * donc requireStoreAccess() à l'intérieur de la fonction réutilisée voit
 * bien la vraie session de l'utilisateur.
 *
 * Ne crée QUE des ActionItem en PENDING_VALIDATION (ou ne fait rien de plus
 * qu'un /api/actions individuel : réutilise un ActionItem existant s'il y en
 * a déjà un — même règle d'idempotence). N'exécute jamais rien ici — la
 * confirmation et l'exécution vivent dans /api/actions/bulk/confirm.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const { storeId, recommendationIds, rule } = (body ?? {}) as {
    storeId?: string;
    recommendationIds?: string[];
    rule?: BulkPricingRule;
  };
  if (!storeId || !Array.isArray(recommendationIds) || recommendationIds.length === 0) {
    return NextResponse.json({ error: "storeId et recommendationIds requis." }, { status: 400 });
  }
  if (recommendationIds.length > MAX_BULK_ITEMS) {
    return NextResponse.json({ error: `Maximum ${MAX_BULK_ITEMS} actions par lot groupé.` }, { status: 400 });
  }

  try {
    const { userId } = await requireStoreAccess(storeId);

    const items: Array<{
      recommendationId: string;
      ok: boolean;
      error?: string;
      actionId?: string;
      title?: string;
      currentPrice?: number | null;
      newPrice?: number | null;
      priceError?: string;
    }> = [];

    // Séquentiel, volontairement : chaque appel repasse par la même logique
    // transactionnelle d'idempotence/anti-conflit que la préparation
    // individuelle (voir actions/route.ts) — l'exécuter en parallèle
    // n'apporterait rien ici (la base fait le travail) et complique la
    // lecture des erreurs partielles.
    for (const recommendationId of recommendationIds) {
      const fakeReq = new NextRequest("http://internal.ondeal/api/actions", {
        method: "POST",
        body: JSON.stringify({ storeId, recommendationId }),
      });
      const res = await createSingleAction(fakeReq);
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; actionId?: string; error?: string };

      if (!res.ok || !data.ok || !data.actionId) {
        items.push({ recommendationId, ok: false, error: data.error ?? "Échec de préparation." });
        continue;
      }

      const rec = await prisma.recommendation.findUnique({ where: { id: recommendationId }, select: { title: true, actionType: true, productId: true, actionPayloadJson: true } });
      const item: (typeof items)[number] = { recommendationId, ok: true, actionId: data.actionId, title: rec?.title };

      // Aperçu de prix pour la modale de confirmation — calculé ici, jamais
      // appliqué : /bulk/confirm transmettra ce newPrice à la confirmation
      // individuelle existante, qui recapture ses propres données fraîches.
      if (rule && rec?.actionType === "update_price") {
        try {
          const payload = JSON.parse(rec.actionPayloadJson ?? "{}") as { variantId?: string };
          const variantId = payload.variantId;
          if (variantId) {
            const [variant, storeDefaults] = await Promise.all([
              prisma.variant.findUnique({ where: { id: variantId }, include: { product: { select: { costAssumption: true } } } }),
              prisma.store.findUnique({ where: { id: storeId }, select: { defaultShippingCost: true, defaultPaymentFeesRate: true } }),
            ]);
            if (variant) {
              const costs = resolveCostInputs(variant, variant.product.costAssumption, storeDefaults);
              const computation = computeBulkPrice(rule, variant.price, costs);
              item.currentPrice = variant.price;
              if (computation.ok) item.newPrice = computation.newPrice;
              else item.priceError = computation.reason;
            }
          }
        } catch {
          item.priceError = "Impossible de calculer un prix pour ce produit.";
        }
      }

      items.push(item);
    }

    const created = items.filter((i) => i.ok).length;
    await logAudit({
      storeId,
      userId,
      actorType: "user",
      event: "action.bulk_prepared",
      message: `Action groupée préparée : ${created}/${recommendationIds.length} action(s) prête(s) pour validation.`,
      meta: { count: created, total: recommendationIds.length },
    });

    return NextResponse.json({ created, items });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }
}
