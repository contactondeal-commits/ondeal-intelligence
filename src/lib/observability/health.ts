import { prisma } from "@/lib/db";

/**
 * ONDEAL AI CORE — FINAL PHASE : Observabilité réelle (06/09/2026).
 *
 * §"observabilité" du mandat final — jusqu'ici totalement absent : aucune
 * route de santé, aucun moyen de savoir depuis l'extérieur (moniteur
 * d'uptime, red-team, e2e-smoke, Claude lui-même) quel commit est
 * RÉELLEMENT déployé en production sans passer par le tableau de bord
 * Vercel — exactement le problème vécu en direct pendant cette même
 * session (06/09/2026) : production restée bloquée sur un commit obsolète
 * pendant des heures, découvert seulement via une capture d'écran du
 * dashboard. computeHealth() rend ce fait vérifiable par une simple requête
 * HTTP, jamais une capture d'écran.
 *
 * `VERCEL_GIT_COMMIT_SHA`/`VERCEL_ENV` sont injectées AUTOMATIQUEMENT par
 * Vercel à chaque déploiement (aucune configuration manuelle requise) —
 * absentes en local (next dev/start hors Vercel), d'où le repli `null`/
 * "development", jamais une valeur inventée.
 */

export interface HealthReport {
  status: "ok" | "degraded";
  database: "ok" | "error";
  databaseError: string | null;
  commit: string | null;
  environment: string;
  timestamp: string;
}

export async function computeHealth(): Promise<HealthReport> {
  let database: "ok" | "error" = "ok";
  let databaseError: string | null = null;
  try {
    // Requête réelle la plus légère possible — jamais une simple vérification
    // "le client Prisma existe", qui ne prouverait rien d'une connexion
    // réseau réellement fonctionnelle vers Postgres.
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    database = "error";
    databaseError = err instanceof Error ? err.message : String(err);
  }

  return {
    status: database === "ok" ? "ok" : "degraded",
    database,
    databaseError,
    commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    environment: process.env.VERCEL_ENV ?? "development",
    timestamp: new Date().toISOString(),
  };
}
