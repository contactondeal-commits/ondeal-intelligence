import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireStoreAccess, AuthError } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { SENSITIVE_ACTION_TYPES } from "@/lib/intelligence/actionTypes";
import { criticalTargetKey } from "@/lib/intelligence/actionKind";
import { buildStockSnapshot } from "@/lib/intelligence/snapshot";
import { fetchCurrentStockFields } from "@/lib/intelligence/stockEvidence";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const { storeId, recommendationId } = body ?? {};
  if (!storeId || !recommendationId) return NextResponse.json({ error: "storeId et recommendationId requis." }, { status: 400 });

  try {
    const { userId } = await requireStoreAccess(storeId);

    const rec = await prisma.recommendation.findUnique({ where: { id: recommendationId } });
    if (!rec || rec.storeId !== storeId) return NextResponse.json({ error: "Recommandation introuvable." }, { status: 404 });
    if (!rec.actionType) return NextResponse.json({ error: "Cette recommandation n'a pas d'action exécutable." }, { status: 400 });

    const sensitivity = SENSITIVE_ACTION_TYPES.has(rec.actionType) ? "SENSITIVE" : "SAFE";

    const basePayload = JSON.parse(rec.actionPayloadJson ?? "{}") as Record<string, unknown>;
    // Donnée critique ciblée par CETTE recommandation (ex. "update_price sur
    // la variante X") — sert à détecter qu'une AUTRE recommandation
    // (différent recommendationId) ne cible pas déjà la même donnée, pas
    // seulement un doublon exact de la même recommandation.
    const targetKey = criticalTargetKey(rec.actionType, basePayload, rec.productId);

    // SNAPSHOT STOCK — pour `review_supplier`, capture ici (au moment de la
    // décision : ce type est SAFE, il n'y a pas d'étape /confirm séparée) la
    // preuve réelle actuelle (stock, vélocité), rechargée fraîchement en
    // base via `analyzeStock` — jamais une valeur venue du payload de la
    // recommandation, potentiellement calculée lors d'un cycle d'analyse
    // antérieur. Même architecture que le snapshot prix (voir snapshot.ts).
    let payloadJson = rec.actionPayloadJson ?? "{}";
    if (rec.actionType === "review_supplier" && rec.productId) {
      const variantId = typeof basePayload.variantId === "string" ? basePayload.variantId : null;
      if (variantId) {
        const currentFields = await fetchCurrentStockFields(rec.productId, variantId);
        if (currentFields) {
          payloadJson = JSON.stringify({
            ...basePayload,
            simulationSnapshot: buildStockSnapshot({
              productId: rec.productId,
              variantId,
              candidateAddedUnits: null,
              fields: currentFields,
            }),
          });
        }
      }
    }

    // Idempotence + anti-conflit : « 1 recommandation active = 1 ActionItem
    // actif », ET « 1 donnée critique = 1 ActionItem actif », même si deux
    // recommandations DIFFÉRENTES (ex. catégories "stock" et "data_quality"
    // pointant toutes deux sur la même variante en rupture) la ciblent
    // toutes les deux. Le tout est exécuté dans une transaction Prisma pour
    // ne pas dépendre uniquement du frontend — double clic, retry réseau,
    // rechargement avant que l'UI ne reprenne son état, ou appels
    // concurrents doivent tous retomber sur le même ActionItem plutôt que
    // d'en créer un deuxième qui pourrait s'exécuter de façon incohérente
    // avec le premier. (Limite honnête : SQLite ne sérialise pas des
    // transactions concurrentes avec la même garantie qu'un index unique
    // côté base — une vraie contrainte DB nécessiterait une migration SQL
    // brute, volontairement non ajoutée ici pour ne pas modifier le schéma
    // sans nécessité réelle avérée. La fenêtre résiduelle est en outre
    // couverte a posteriori par le contrôle de fraîcheur du snapshot à
    // l'exécution : si une première ActionItem concurrente s'exécute quand
    // même avant, la seconde détecte la donnée changée et est bloquée.)
    const { action, resumed, conflict } = await prisma.$transaction(async (tx) => {
      const sameRecommendation = await tx.actionItem.findFirst({
        where: { recommendationId, status: { in: ["PENDING_VALIDATION", "CONFIRMED"] } },
        orderBy: { createdAt: "desc" },
      });
      if (sameRecommendation) return { action: sameRecommendation, resumed: true, conflict: false };

      if (targetKey) {
        const sameTypeActive = await tx.actionItem.findMany({
          where: { storeId, type: rec.actionType!, status: { in: ["PENDING_VALIDATION", "CONFIRMED"] } },
        });
        const conflicting = sameTypeActive.find((a) => {
          try {
            const p = JSON.parse(a.payloadJson) as Record<string, unknown>;
            return criticalTargetKey(a.type, p, rec.productId) === targetKey;
          } catch {
            return false;
          }
        });
        if (conflicting) return { action: conflicting, resumed: true, conflict: true };
      }

      const created = await tx.actionItem.create({
        data: {
          storeId,
          recommendationId,
          type: rec.actionType!,
          sensitivity,
          status: "PENDING_VALIDATION",
          payloadJson,
          createdByUserId: userId,
        },
      });
      return { action: created, resumed: false, conflict: false };
    });

    if (resumed) {
      if (conflict) {
        await logAudit({
          storeId,
          userId,
          actorType: "user",
          event: "action.conflict_avoided",
          message: `Recommandation "${rec.title}" (${rec.actionType}) cible la même donnée qu'une action déjà active — action existante réutilisée plutôt qu'un doublon incohérent créé.`,
          meta: { actionId: action.id, recommendationId },
        });
      }
      return NextResponse.json({ ok: true, actionId: action.id, resumed: true, conflict });
    }

    await logAudit({
      storeId,
      userId,
      actorType: "user",
      event: "action.prepared",
      message: `Action préparée : "${rec.title}" (${rec.actionType}). En attente de validation.`,
      meta: { actionId: action.id },
    });

    return NextResponse.json({ ok: true, actionId: action.id });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }
}
