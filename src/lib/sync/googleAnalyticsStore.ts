import { prisma } from "@/lib/db";
import { decryptJson, encryptJson } from "@/lib/crypto";
import { logAudit } from "@/lib/audit";
import {
  refreshGaAccessToken,
  fetchDailyAggregate,
  fetchChannelAggregate,
  parseGaDate,
  type GoogleAnalyticsCredentials,
} from "@/lib/integrations/google-analytics";
import { recomputeStoreIntelligence } from "@/lib/intelligence/pipeline";

/** Fenêtre de rapport GA4 lue à chaque synchronisation (jours). */
export const GA_WINDOW_DAYS = 30;

function formatGaDate(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

export type GaSyncStatus = "success" | "error" | "not_connected" | "pending_property" | "refused_demo";

/**
 * Synchronisation Google Analytics — indépendante du catalogue (comme
 * CJdropshipping), voir shopifyStore.ts/pipeline.ts (sync/pipeline.ts) pour
 * le même schéma FETCH → STORE → ANALYZE → SyncRun/AuditLog. `refreshToken`
 * n'est JAMAIS renouvelé automatiquement par Google (il reste valide tant
 * que le marchand n'a pas révoqué l'accès) — seul l'access_token de courte
 * durée est rafraîchi ici, à chaque synchronisation.
 */
export async function syncGoogleAnalytics(
  storeId: string,
  triggeredBy: "manual" | "scheduled",
): Promise<{ status: GaSyncStatus; itemsFetched: number; itemsStored: number; errorCount: number }> {
  const store = await prisma.store.findUnique({ where: { id: storeId }, select: { isDemo: true } });
  if (!store) return { status: "error", itemsFetched: 0, itemsStored: 0, errorCount: 1 };
  if (store.isDemo) return { status: "refused_demo", itemsFetched: 0, itemsStored: 0, errorCount: 0 };

  const integration = await prisma.integration.findUnique({
    where: { storeId_provider: { storeId, provider: "GOOGLE_ANALYTICS" } },
  });
  if (!integration || integration.status !== "CONNECTED" || !integration.encryptedCredentials) {
    return { status: "not_connected", itemsFetched: 0, itemsStored: 0, errorCount: 0 };
  }

  const creds = decryptJson<GoogleAnalyticsCredentials>(integration.encryptedCredentials);
  if (!creds.propertyId) {
    // Autorisation OAuth faite, mais la propriété GA4 n'a pas encore été
    // choisie (voir /api/integrations/google-analytics/select-property) —
    // pas une erreur, rien à synchroniser tant que ce choix n'est pas fait.
    return { status: "pending_property", itemsFetched: 0, itemsStored: 0, errorCount: 0 };
  }

  const run = await prisma.syncRun.create({ data: { storeId, provider: "GOOGLE_ANALYTICS", status: "running", triggeredBy } });

  try {
    const accessToken = await refreshGaAccessToken(creds.refreshToken);

    const end = new Date();
    const start = new Date(end.getTime() - GA_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const startDate = formatGaDate(start);
    const endDate = formatGaDate(end);

    const [daily, channels] = await Promise.all([
      fetchDailyAggregate(accessToken, creds.propertyId, startDate, endDate),
      fetchChannelAggregate(accessToken, creds.propertyId, startDate, endDate),
    ]);

    let stored = 0;
    for (const row of daily) {
      if (!row.date) continue;
      await prisma.analyticsSnapshot.upsert({
        where: { storeId_date: { storeId, date: parseGaDate(row.date) } },
        create: {
          storeId,
          date: parseGaDate(row.date),
          sessions: row.sessions,
          activeUsers: row.activeUsers,
          newUsers: row.newUsers,
          conversions: row.conversions,
          revenue: row.revenue,
        },
        update: {
          sessions: row.sessions,
          activeUsers: row.activeUsers,
          newUsers: row.newUsers,
          conversions: row.conversions,
          revenue: row.revenue,
        },
      });
      stored += 1;
    }

    for (const row of channels) {
      if (!row.date) continue;
      await prisma.analyticsChannelSnapshot.upsert({
        where: { storeId_date_sourceMedium: { storeId, date: parseGaDate(row.date), sourceMedium: row.sourceMedium } },
        create: {
          storeId,
          date: parseGaDate(row.date),
          sourceMedium: row.sourceMedium,
          sessions: row.sessions,
          conversions: row.conversions,
          revenue: row.revenue,
        },
        update: { sessions: row.sessions, conversions: row.conversions, revenue: row.revenue },
      });
      stored += 1;
    }

    await prisma.integration.update({ where: { id: integration.id }, data: { lastSyncedAt: new Date(), lastError: null } });
    await prisma.syncRun.update({
      where: { id: run.id },
      data: { status: "success", finishedAt: new Date(), itemsFetched: daily.length + channels.length, itemsStored: stored, errorCount: 0 },
    });
    await logAudit({
      storeId,
      actorType: "system",
      event: "sync.completed",
      message: `Synchronisation Google Analytics : ${daily.length} jour(s), ${channels.length} ligne(s) de canal.`,
      meta: { itemsFetched: daily.length + channels.length, itemsStored: stored },
    });

    // ANALYZE → recalcule aussi les signaux trafic (voir traffic.ts/pipeline.ts).
    await recomputeStoreIntelligence(storeId);

    return { status: "success", itemsFetched: daily.length + channels.length, itemsStored: stored, errorCount: 0 };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.integration.update({ where: { id: integration.id }, data: { lastError: message, status: "ERROR" } });
    await prisma.syncRun.update({ where: { id: run.id }, data: { status: "error", finishedAt: new Date(), errorCount: 1 } });
    await logAudit({ storeId, actorType: "system", event: "sync.failed", message: `Échec de synchronisation Google Analytics : ${message}` });
    return { status: "error", itemsFetched: 0, itemsStored: 0, errorCount: 1 };
  }
}

// Réexporté pour /api/integrations/google-analytics/select-property, qui a
// besoin de ré-encoder les credentials avec le propertyId choisi sans
// dupliquer la forme du blob chiffré ailleurs.
export function encryptGaCredentials(creds: GoogleAnalyticsCredentials): string {
  return encryptJson(creds);
}
