import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireStoreAccess, requireRole, WRITE_ROLES, AuthError } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { POST as confirmSingleAction } from "@/app/api/actions/[id]/confirm/route";
import { POST as executeSingleAction } from "@/app/api/actions/[id]/execute/route";
import { hasFeature, planForStore } from "@/lib/plan-limits";

const MAX_BULK_ITEMS = 50;

/**
 * Chantier 3 — Actions groupées, étape 2/2 : confirmation + exécution.
 *
 * "Zéro nouvelle logique d'exécution" : pour chaque ActionItem, appelle
 * directement — en mémoire, même process, même requête HTTP — les fonctions
 * POST exportées par /api/actions/[id]/confirm/route.ts puis
 * /api/actions/[id]/execute/route.ts, EXACTEMENT comme le ferait un humain
 * qui validerait puis exécuterait chaque décision une par une depuis le
 * Decision Workspace. Snapshot de simulation, vérification de fraîcheur des
 * données avant mutation Shopify, statut CONFIRMED → EXECUTED/FAILED, audit
 * — tout vient de ce code inchangé, jamais réécrit ici.
 *
 * Échec partiel assumé et normal : chaque item est indépendant, un échec
 * n'annule pas les autres (voir `items` en réponse — succès marqués
 * EXECUTED, échecs FAILED, exactement comme le worker individuel le ferait
 * pour chacun séparément).
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const { storeId, items: requested } = (body ?? {}) as {
    storeId?: string;
    items?: Array<{ actionId: string; newPrice?: number }>;
  };
  if (!storeId || !Array.isArray(requested) || requested.length === 0) {
    return NextResponse.json({ error: "storeId et items requis." }, { status: 400 });
  }
  if (requested.length > MAX_BULK_ITEMS) {
    return NextResponse.json({ error: `Maximum ${MAX_BULK_ITEMS} actions par lot groupé.` }, { status: 400 });
  }

  try {
    const { userId, role } = await requireStoreAccess(storeId);
    requireRole(role, WRITE_ROLES);

    // VERROU DE PLAN CÔTÉ SERVEUR (audit conformité 05/09/2026) — même
    // règle que /api/actions/bulk : réservé BUSINESS/AGENCY.
    const plan = await planForStore(storeId);
    if (!hasFeature(plan, "advanced_automations")) {
      return NextResponse.json({ error: "Les actions groupées nécessitent le plan BUSINESS ou supérieur." }, { status: 403 });
    }

    const results: Array<{
      actionId: string;
      confirmOk: boolean;
      confirmError?: string;
      executed?: boolean;
      executeOk?: boolean;
      detail?: string;
    }> = [];

    // Séquentiel et non parallèle, volontairement : chaque exécution touche
    // potentiellement l'API Shopify (rate limits réels), et le snapshot de
    // fraîcheur de chaque item doit être vérifié dans un ordre déterministe.
    for (const { actionId, newPrice } of requested) {
      const action = await prisma.actionItem.findUnique({ where: { id: actionId }, select: { id: true, storeId: true, sensitivity: true, status: true } });
      if (!action || action.storeId !== storeId) {
        results.push({ actionId, confirmOk: false, confirmError: "Action introuvable pour cette boutique." });
        continue;
      }

      let confirmOk = true;
      let confirmError: string | undefined;

      // SENSITIVE seulement : les actions SAFE (ex. request_reviews)
      // s'exécutent directement depuis PENDING_VALIDATION — même règle que
      // le Decision Workspace individuel (voir execute/route.ts).
      if (action.sensitivity === "SENSITIVE") {
        const confirmReq = new NextRequest(`http://internal.ondeal/api/actions/${actionId}/confirm`, {
          method: "POST",
          body: JSON.stringify(newPrice !== undefined ? { params: { newPrice } } : {}),
        });
        const confirmRes = await confirmSingleAction(confirmReq, { params: Promise.resolve({ id: actionId }) });
        const confirmData = (await confirmRes.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        confirmOk = confirmRes.ok && !!confirmData.ok;
        confirmError = confirmOk ? undefined : confirmData.error ?? "Échec de la confirmation.";
      }

      if (!confirmOk) {
        results.push({ actionId, confirmOk: false, confirmError });
        continue;
      }

      const executeReq = new NextRequest(`http://internal.ondeal/api/actions/${actionId}/execute`, { method: "POST" });
      const executeRes = await executeSingleAction(executeReq, { params: Promise.resolve({ id: actionId }) });
      const executeData = (await executeRes.json().catch(() => ({}))) as { ok?: boolean; detail?: string };

      results.push({ actionId, confirmOk: true, executed: true, executeOk: !!executeData.ok, detail: executeData.detail });
    }

    const executedOk = results.filter((r) => r.executeOk).length;
    const failed = results.length - executedOk;

    await logAudit({
      storeId,
      userId,
      actorType: "user",
      event: "action.bulk_confirmed",
      message: `Action groupée confirmée : ${executedOk}/${results.length} exécutée(s) avec succès, ${failed} échec(s).`,
      meta: { count: results.length, executedOk, failed, actionIds: requested.map((r) => r.actionId) },
    });

    return NextResponse.json({ confirmed: results.length, executed: executedOk, failed, items: results });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }
}
