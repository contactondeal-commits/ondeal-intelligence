import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { syncCatalog, syncJudgeme } from "@/lib/sync/pipeline";
import { syncGoogleAnalytics } from "@/lib/sync/googleAnalyticsStore";

// Synchro planifiée (Vercel Cron, voir vercel.json) — toutes les boutiques
// non-démo, toutes les 6h. syncCatalog (04/09/2026) détecte lui-même quelle
// intégration catalogue est connectée (SHOPIFY, WOOCOMMERCE ou PRESTASHOP —
// au plus une à la fois par boutique) plutôt que de supposer Shopify, donc
// cette route couvre les trois plateformes sans changement supplémentaire.

export const maxDuration = 300; // secondes — nécessite le plan Vercel Pro

const RUNNING_GUARD_MS = 15 * 60 * 1000;

export function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization");
  return header === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Non autorisé." }, { status: 401 });

  const stores = await prisma.store.findMany({ where: { isDemo: false }, select: { id: true, name: true } });
  const results: Array<{ storeId: string; storeName: string; catalog: string; judgeme: string; googleAnalytics: string; skipped?: boolean }> = [];

  for (const store of stores) {
    const running = await prisma.syncRun.findFirst({
      where: { storeId: store.id, status: "running", startedAt: { gte: new Date(Date.now() - RUNNING_GUARD_MS) } },
      select: { id: true },
    });
    if (running) {
      results.push({ storeId: store.id, storeName: store.name, catalog: "skipped", judgeme: "skipped", googleAnalytics: "skipped", skipped: true });
      continue;
    }
    try {
      // Google Analytics est indépendant du catalogue (comme Judge.me) —
      // "not_connected"/"pending_property" pour une boutique qui ne l'a pas
      // configuré ne dégrade jamais le résultat des deux autres.
      const [catalog, judgeme, googleAnalytics] = await Promise.all([
        syncCatalog(store.id, "scheduled"),
        syncJudgeme(store.id, "scheduled"),
        syncGoogleAnalytics(store.id, "scheduled"),
      ]);
      results.push({ storeId: store.id, storeName: store.name, catalog: catalog.status, judgeme: judgeme.status, googleAnalytics: googleAnalytics.status });
    } catch (err) {
      console.error("[cron/sync] erreur inattendue", { storeId: store.id, error: err instanceof Error ? err.message : String(err) });
      results.push({ storeId: store.id, storeName: store.name, catalog: "error", judgeme: "error", googleAnalytics: "error" });
    }
  }

  const synced = results.filter((r) => !r.skipped);
  const skipped = results.filter((r) => r.skipped);
  console.info("[cron/sync] terminé", { processed: synced.length, skipped: skipped.length, results });
  return NextResponse.json({ ok: true, processed: synced.length, skipped: skipped.length, results });
}
