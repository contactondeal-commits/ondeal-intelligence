import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireStoreAccess, requireRole, WRITE_ROLES, AuthError } from "@/lib/auth";
import { syncCatalog, syncJudgeme } from "@/lib/sync/pipeline";

// CORRECTIF 05/09/2026 — cette route (bouton "Synchroniser" manuel) n'avait
// AUCUNE limite de temps configurée, contrairement à /api/cron/sync (la même
// opération, déclenchée automatiquement) qui déclare `maxDuration = 300`
// depuis le début. Sur un gros catalogue (16 000+ variantes constaté en
// production), la requête dépassait la limite par défaut de la plateforme :
// la fonction serverless était tuée en plein traitement, sans qu'aucun
// catch/finally ne puisse s'exécuter (un timeout plateforme ne laisse pas
// le code se terminer proprement) — le SyncRun restait bloqué "running", et
// côté navigateur le bouton "Synchroniser" restait figé indéfiniment (voir
// SyncButton.tsx, désormais protégé par un try/catch/finally). Même plafond
// que /api/cron/sync pour que le bouton manuel ait autant de temps que la
// synchronisation planifiée qui gère déjà ce volume.
export const maxDuration = 300;

// Une synchronisation encore marquée "running" depuis moins de 15 min bloque
// tout nouveau lancement (protection quota Shopify / temps d'exécution).
const RUNNING_GUARD_MS = 15 * 60 * 1000;

export async function POST(req: NextRequest) {
  const parsed = z.object({ storeId: z.string().min(1).max(64) }).strict().safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "storeId requis." }, { status: 400 });
  const storeId = parsed.data.storeId;

  try {
    const { role } = await requireStoreAccess(storeId);
    requireRole(role, WRITE_ROLES);
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }

  const running = await prisma.syncRun.findFirst({ where: { storeId, status: "running", startedAt: { gte: new Date(Date.now() - RUNNING_GUARD_MS) } }, select: { id: true } });
  if (running) return NextResponse.json({ error: "Une synchronisation est déjà en cours pour cette boutique." }, { status: 409 });

  // syncCatalog (04/09/2026) détecte lui-même quelle intégration catalogue
  // (SHOPIFY, WOOCOMMERCE ou PRESTASHOP) est connectée pour cette boutique —
  // au plus une à la fois — plutôt que de supposer Shopify. "shopify" reste
  // le nom de la clé de réponse (compatibilité : rien côté client ne lit
  // cette clé aujourd'hui, voir SyncButton.tsx, mais casser un contrat
  // public sans raison n'a pas de sens) ; son contenu couvre désormais
  // n'importe quelle plateforme catalogue connectée.
  const [shopify, judgeme] = await Promise.all([
    syncCatalog(storeId, "manual"),
    syncJudgeme(storeId, "manual"),
  ]);

  return NextResponse.json({ ok: true, shopify, judgeme });
}
