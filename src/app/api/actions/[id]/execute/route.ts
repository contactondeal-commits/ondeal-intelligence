import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireStoreAccess, requireRole, WRITE_ROLES, AuthError } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { updateVariantPrice, updateProductStatus, type ShopifyCredentials } from "@/lib/integrations/shopify";
import { getFreshShopifyCredentials } from "@/lib/integrations/shopify-token";
import { queryCjVariantStock, type CjCredentials } from "@/lib/integrations/cjdropshipping";
import { getFreshCjCredentials } from "@/lib/integrations/cjdropshipping-token";
import { isPriceStale } from "@/lib/intelligence/decision";
import {
  comparePriceSnapshot,
  compareStockSnapshot,
  compareMultiStockSnapshot,
  describeSnapshotChange,
  describeStockSnapshotChange,
  describeMultiStockSnapshotChange,
  isPriceSnapshot,
  isStockSnapshot,
  isMultiStockSnapshot,
  type PriceSnapshotFields,
} from "@/lib/intelligence/snapshot";
import { fetchCurrentStockFields, fetchCurrentStockFieldsMulti } from "@/lib/intelligence/stockEvidence";
import { resolveCostInputs } from "@/lib/intelligence/costs";
import { isPricePrediction, measurePriceOutcome } from "@/lib/intelligence/prediction";
import type { ExecutionOutcome } from "@/lib/intelligence/actionKind";

/** Refus d'exécution pour cause de simulation obsolète — porte le détail de ce qui a changé jusqu'au résultat persisté, sans jamais l'exécuter aveuglément. */
// Erreur métier volontairement lisible par l'utilisateur (message français
// maîtrisé). Toute autre exception (Prisma, chiffrement, réseau) est
// journalisée côté serveur et remplacée par un message générique.
class ExecutionError extends Error {}

class StaleSimulationError extends Error {
  changedFields: Array<{ field: string; label: string; expected: number | null; actual: number | null }>;
  constructor(message: string, changedFields: Array<{ field: string; label: string; expected: number | null; actual: number | null }>) {
    super(message);
    this.name = "StaleSimulationError";
    this.changedFields = changedFields;
  }
}

// PHASE 13 — Exécution. Séquence obligatoire :
// IA → recommandation → explication → validation humaine (CONFIRMED) → exécution → vérification.
// Les actions SENSITIVE ne s'exécutent JAMAIS avant confirmation explicite.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const action = await prisma.actionItem.findUnique({ where: { id } });
  if (!action) return NextResponse.json({ error: "Action introuvable." }, { status: 404 });

  let userId: string;
  try {
    const access = await requireStoreAccess(action.storeId);
    userId = access.userId;
    // Seuls OWNER/ADMIN/ANALYST peuvent exécuter ; VIEWER = lecture seule.
    requireRole(access.role, WRITE_ROLES);
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
  let result: ExecutionOutcome;

  try {
    switch (action.type) {
      case "update_price":
        result = await executeUpdatePrice(action.storeId, payload);
        break;
      case "unpublish_product":
        result = await executeUnpublish(action.storeId, payload);
        break;
      case "review_supplier":
        result = await executeReviewSupplier(action.storeId, payload);
        break;
      case "request_reviews":
      case "promote_product":
      case "edit_product_data":
        // Actions informationnelles : pas de mutation API disponible pour
        // ces tâches (relèvent d'une décision commerciale/fournisseur
        // externe). "Exécuter" ici documente que la mission a été prise en
        // charge par l'utilisateur — jamais présenté comme une vraie
        // mutation Shopify qui n'a pas eu lieu (kind: manual_mission_completed).
        result = {
          ok: true,
          kind: "manual_mission_completed",
          detail: "Mission marquée comme prise en charge par vous — OnDeal n'a effectué aucune modification automatique de la boutique pour ce type d'action.",
        };
        break;
      default:
        result = { ok: false, kind: "error", detail: `Type d'action non pris en charge par le moteur d'exécution : ${action.type}` };
    }
  } catch (err) {
    if (err instanceof StaleSimulationError) {
      result = { ok: false, kind: "stale_simulation", detail: err.message, changedFields: err.changedFields };
    } else if (err instanceof ExecutionError) {
      result = { ok: false, kind: "error", detail: err.message };
    } else {
      console.error("[actions/execute] erreur interne", { actionId: id, error: err instanceof Error ? err.message : String(err) });
      result = { ok: false, kind: "error", detail: "Erreur interne lors de l'exécution — aucune modification n'a été appliquée à la boutique." };
    }
  }

  const finalStatus = result.ok ? "EXECUTED" : "FAILED";
  const verification = result.ok && result.kind === "automated_mutation" ? result.verification : undefined;

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
    message: `Action ${action.type} ${result.ok ? "exécutée" : "échouée"} (${result.kind}) : ${result.detail}${verification ? " — Vérification : " + verification : ""}`,
    meta: { actionId: id },
  });

  return NextResponse.json({ ...result });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Nombre max de variantes vérifiées en direct auprès de CJ en un seul clic
// "Vérifier le fournisseur" — une mission groupée (voir group.ts) peut
// porter jusqu'à plusieurs dizaines de variantes ; on plafonne pour ne
// jamais risquer de heurter la limite de débit CJ sur un seul clic humain.
// Les variantes au-delà de ce plafond ne sont simplement pas vérifiées —
// jamais un résultat inventé pour elles.
const MAX_CJ_LOOKUPS_PER_EXECUTION = 20;
const CJ_LOOKUP_DELAY_MS = 350;

/**
 * `null` si CJ n'est pas connecté pour cette boutique — le connecteur est
 * optionnel, jamais requis pour exécuter "Vérifier le fournisseur". Passe
 * TOUJOURS par `getFreshCjCredentials` (jamais un décryptage direct) pour
 * garantir un accessToken valide — voir cjdropshipping-token.ts. Un échec de
 * renouvellement dégrade en "CJ non disponible pour cette exécution" plutôt
 * que de bloquer la mission (même logique best-effort que `checkCjStock`
 * ci-dessous pour une variante individuelle).
 */
async function getCjCreds(storeId: string): Promise<CjCredentials | null> {
  const integration = await prisma.integration.findUnique({ where: { storeId_provider: { storeId, provider: "CJDROPSHIPPING" } } });
  if (!integration || integration.status !== "CONNECTED" || !integration.encryptedCredentials) return null;
  try {
    return await getFreshCjCredentials(integration);
  } catch {
    return null;
  }
}

/**
 * Vérifie en direct auprès de CJ le stock réel des variantes fournies, et
 * met à jour `Variant.supplierStock` avec la valeur RÉELLE reçue — c'est ce
 * même champ que `supplierMismatch` (recommendations.ts) lit déjà pour
 * distinguer une vraie rupture d'un simple défaut de synchro de l'app CJ.
 * Best-effort : une erreur CJ (clé invalide, SKU inconnu, réseau) pour UNE
 * variante n'empêche jamais de vérifier les autres, ni de terminer la
 * mission — cette vérification reste une enrichissement, jamais une
 * condition bloquante de "Vérifier le fournisseur".
 */
async function checkCjStock(storeId: string, variantIds: string[]): Promise<string | null> {
  const creds = await getCjCreds(storeId);
  if (!creds) return null;

  const variants = await prisma.variant.findMany({
    where: { id: { in: variantIds.slice(0, MAX_CJ_LOOKUPS_PER_EXECUTION) }, sku: { not: null } },
    select: { id: true, sku: true, title: true },
  });
  if (variants.length === 0) return null;

  const lines: string[] = [];
  let mismatchCount = 0;
  let confirmedCount = 0;

  for (let i = 0; i < variants.length; i++) {
    const v = variants[i]!;
    if (i > 0) await sleep(CJ_LOOKUP_DELAY_MS);
    try {
      const stock = await queryCjVariantStock(creds, v.sku!);
      if (!stock) {
        lines.push(`${v.title} (${v.sku}) : SKU inconnu chez CJ.`);
        continue;
      }
      await prisma.variant.update({ where: { id: v.id }, data: { supplierStock: stock.cjInventory } });
      if (stock.cjInventory > 0) {
        mismatchCount++;
        lines.push(`${v.title} (${v.sku}) : CJ indique ${stock.cjInventory} unité(s) disponible(s) — pas encore synchronisé sur Shopify.`);
      } else {
        confirmedCount++;
        lines.push(`${v.title} (${v.sku}) : CJ confirme 0 unité — rupture réelle chez le fournisseur.`);
      }
    } catch (err) {
      lines.push(`${v.title} (${v.sku}) : vérification CJ impossible (${err instanceof Error ? err.message : "erreur inconnue"}).`);
    }
  }

  const summary =
    mismatchCount > 0
      ? `⚠️ Vérifié en direct chez CJ : ${mismatchCount} variante(s) ont en réalité du stock chez CJ, non synchronisé sur Shopify — vérifiez l'app CJ.`
      : confirmedCount > 0
        ? `Vérifié en direct chez CJ : rupture confirmée réellement côté fournisseur pour ${confirmedCount} variante(s).`
        : "CJ n'a renvoyé aucune correspondance exploitable pour ces SKU.";

  return [summary, ...lines].join("\n");
}

async function getShopifyCreds(storeId: string): Promise<ShopifyCredentials> {
  const integration = await prisma.integration.findUnique({ where: { storeId_provider: { storeId, provider: "SHOPIFY" } } });
  if (!integration || integration.status !== "CONNECTED" || !integration.encryptedCredentials) {
    throw new ExecutionError("Shopify n'est pas connecté pour cette boutique — impossible d'exécuter cette action.");
  }
  // Rafraîchit un jeton EXPIRANT proche de l'échéance avant une mutation
  // Shopify réelle (04/09/2026 — correctif, voir shopify-token.ts) ; no-op
  // pour un jeton classique non-expirant.
  return getFreshShopifyCredentials(integration);
}

async function executeUpdatePrice(storeId: string, payload: Record<string, unknown>): Promise<ExecutionOutcome> {
  const productId = payload.productId as string;
  const variantId = payload.variantId as string;
  const newPrice = Number(payload.newPrice);
  if (!productId || !variantId) throw new ExecutionError("Produit/variante manquant dans l'action.");
  if (!newPrice || Number.isNaN(newPrice) || newPrice <= 0) {
    throw new ExecutionError("Aucun nouveau prix valide fourni — saisissez un prix avant de confirmer cette action.");
  }

  // Isolation multi-boutiques : produit ET variante doivent appartenir à la
  // boutique de l'action (les identifiants viennent du payload serveur, mais
  // la vérification est refaite ici, juste avant la mutation).
  const [product, variant, costAssumption, storeDefaults] = await Promise.all([
    prisma.product.findFirst({ where: { id: productId, storeId } }),
    prisma.variant.findFirst({ where: { id: variantId, productId, product: { storeId } } }),
    prisma.costAssumption.findUnique({ where: { productId } }),
    prisma.store.findUnique({ where: { id: storeId }, select: { defaultShippingCost: true, defaultPaymentFeesRate: true } }),
  ]);
  if (!product || !variant) throw new ExecutionError("Produit/variante introuvable en base — il a peut-être été supprimé depuis la simulation.");

  // Même résolution de coût qu'à la confirmation (coût réel Shopify
  // prioritaire, hypothèses en repli) — sinon la comparaison de snapshot
  // comparerait deux sources différentes.
  const costs = resolveCostInputs(variant, costAssumption, storeDefaults);
  const currentFields: PriceSnapshotFields = {
    currentPrice: variant.price,
    supplierCost: costs.supplierCost,
    shippingCost: costs.shippingCost,
    paymentFeesRate: costs.paymentFeesRate,
    otherFixedCost: costs.otherFixedCost,
  };

  // SNAPSHOT DE SIMULATION (priorité absolue) : compare les données
  // multi-champs capturées par /confirm au moment de la validation humaine
  // aux données réelles actuelles, juste avant la mutation Shopify. Toute
  // décision calculée sur une donnée devenue obsolète (prix, coûts) entre
  // la confirmation et l'exécution est refusée — jamais appliquée
  // aveuglément — et une nouvelle simulation est requise.
  const rawSnapshot = payload.simulationSnapshot;
  if (isPriceSnapshot(rawSnapshot)) {
    const comparison = comparePriceSnapshot(rawSnapshot, currentFields);
    if (comparison.stale) {
      throw new StaleSimulationError(describeSnapshotChange(comparison), comparison.changedFields);
    }
  } else {
    // Repli pour une ActionItem plus ancienne, préparée avant l'ajout du
    // snapshot multi-champs : au minimum, le prix est vérifié comme avant.
    const expectedPrice = typeof payload.currentPrice === "number" ? payload.currentPrice : null;
    if (isPriceStale(expectedPrice, variant.price)) {
      throw new StaleSimulationError(
        `Les données ont changé depuis votre simulation (Prix actuel : ${expectedPrice !== null ? expectedPrice.toFixed(2) + " €" : "inconnu"} → ${variant.price !== null ? variant.price.toFixed(2) + " €" : "inconnu"}). Une nouvelle simulation est nécessaire avant l'exécution.`,
        [{ field: "currentPrice", label: "Prix actuel", expected: expectedPrice, actual: variant.price }],
      );
    }
  }

  const creds = await getShopifyCreds(storeId);
  const res = await updateVariantPrice(creds, product.shopifyProductId, variant.shopifyVariantId, newPrice);
  if (!res.ok) throw new ExecutionError(res.error);

  // VÉRIFICATION : on relit la valeur retournée par Shopify (pas seulement
  // "pas d'erreur") et on met à jour notre copie locale pour rester cohérent
  // jusqu'à la prochaine synchronisation complète.
  await prisma.variant.update({ where: { id: variantId }, data: { price: Number(res.price) } });

  // MESURE STRUCTURELLE (PREDICTION → RESULT → GAP) : prix relu de Shopify
  // et coût réel au moment de l'exécution, comparés à la prédiction
  // persistée à la confirmation. Mesure comptable ; la mesure commerciale
  // différée reste « données insuffisantes » tant que le volume manque.
  const rawPrediction = payload.prediction;
  const measurement = isPricePrediction(rawPrediction)
    ? measurePriceOutcome({
        prediction: rawPrediction,
        appliedPrice: Number(res.price),
        supplierCost: costs.supplierCost,
        supplierCostSource: costs.supplierCostSource,
      })
    : undefined;

  return {
    ok: true,
    kind: "automated_mutation",
    detail: `Prix mis à jour sur Shopify : ${res.price} €.`,
    verification: `Confirmé par la réponse Shopify (nouveau prix : ${res.price} €).`,
    before: currentFields.currentPrice,
    applied: newPrice,
    verified: Number(res.price),
    measurement,
  };
}

/**
 * SNAPSHOT STOCK — mission "review_supplier" (rupture / rupture imminente /
 * incohérence fournisseur). Aucune mutation Shopify réelle n'existe pour ce
 * type (voir actionKind.ts) : ce qui doit être protégé n'est pas une
 * exécution, c'est la PREUVE. Si le stock/la vélocité ont réellement changé
 * depuis la préparation de la mission, elle n'est pas close silencieusement
 * sur une preuve obsolète — même architecture, mêmes primitives
 * (`analyzeStock` via `fetchCurrentStockFields`) que pour le prix.
 */
async function executeReviewSupplier(storeId: string, payload: Record<string, unknown>): Promise<ExecutionOutcome> {
  const rawSnapshot = payload.simulationSnapshot;
  if (isMultiStockSnapshot(rawSnapshot)) {
    // Mission agrégée par produit — voir recommendations.ts et snapshot.ts.
    // Obsolète dès qu'AU MOINS UNE des variantes du groupe a changé.
    const current = await fetchCurrentStockFieldsMulti(rawSnapshot.productId, rawSnapshot.variantIds);
    if (current.size > 0) {
      const comparison = compareMultiStockSnapshot(rawSnapshot, current);
      if (comparison.stale) {
        throw new StaleSimulationError(describeMultiStockSnapshotChange(comparison), comparison.changedFields);
      }
    }
    // Aucune variante du groupe retrouvée (toutes supprimées depuis) : rien
    // à comparer — même raisonnement que le cas mono-variante ci-dessous.
  } else if (isStockSnapshot(rawSnapshot)) {
    const current = await fetchCurrentStockFields(rawSnapshot.productId, rawSnapshot.variantId);
    if (current) {
      const comparison = compareStockSnapshot(rawSnapshot, current);
      if (comparison.stale) {
        throw new StaleSimulationError(describeStockSnapshotChange(comparison), comparison.changedFields);
      }
    }
    // Variante introuvable (supprimée depuis) : rien à comparer, mais aucune
    // mutation Shopify n'est en jeu pour ce type — la mission reste
    // informationnelle et peut être close (contrairement à update_price, où
    // un produit/variante introuvable bloque une vraie mutation).
  }
  const baseDetail =
    "Mission marquée comme prise en charge par vous — OnDeal n'a effectué aucune modification automatique de la boutique pour ce type d'action.";

  // Enrichissement optionnel (05/09/2026) : si CJdropshipping est connecté
  // pour cette boutique, vérifie en direct le stock réel des variantes
  // concernées AVANT de clore la mission comme "prise en charge" — jamais
  // une valeur inventée, jamais bloquant si CJ échoue (voir checkCjStock).
  const variantIds: string[] =
    typeof payload.variantId === "string"
      ? [payload.variantId]
      : Array.isArray(payload.variantIds)
        ? (payload.variantIds as unknown[]).filter((v): v is string => typeof v === "string")
        : [];

  let cjDetail: string | null = null;
  if (variantIds.length > 0) {
    try {
      cjDetail = await checkCjStock(storeId, variantIds);
    } catch (err) {
      console.error("[actions/execute] vérification CJ échouée (non bloquant)", {
        storeId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    ok: true,
    kind: "manual_mission_completed",
    detail: cjDetail ? `${baseDetail}\n\n${cjDetail}` : baseDetail,
  };
}

async function executeUnpublish(storeId: string, payload: Record<string, unknown>): Promise<ExecutionOutcome> {
  const productId = payload.productId as string;
  if (!productId) throw new ExecutionError("Produit manquant dans l'action.");
  const product = await prisma.product.findFirst({ where: { id: productId, storeId } });
  if (!product) throw new ExecutionError("Produit introuvable en base — il a peut-être été supprimé depuis la simulation.");

  const creds = await getShopifyCreds(storeId);
  const res = await updateProductStatus(creds, product.shopifyProductId, "DRAFT");
  if (!res.ok) throw new ExecutionError(res.error);

  await prisma.product.update({ where: { id: productId }, data: { status: res.status.toLowerCase() } });

  return {
    ok: true,
    kind: "automated_mutation",
    detail: "Produit dépublié (statut Draft) sur Shopify.",
    verification: `Confirmé par la réponse Shopify (statut : ${res.status}).`,
    before: product.status,
    applied: "draft",
    verified: res.status.toLowerCase(),
  };
}
