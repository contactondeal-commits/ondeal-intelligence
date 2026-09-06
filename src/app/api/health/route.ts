import { NextResponse } from "next/server";
import { computeHealth } from "@/lib/observability/health";

/**
 * ONDEAL AI CORE — FINAL PHASE : Observabilité réelle (06/09/2026).
 *
 * Volontairement PUBLIC (aucune session requise) : une sonde de santé doit
 * être appelable par un moniteur d'uptime externe ou un script de
 * vérification post-déploiement SANS jamais exiger d'authentification —
 * même principe que /api/webhooks/* (authentifiés autrement, jamais par un
 * cookie de session). Ne renvoie STRICTEMENT rien de sensible : ni données
 * marchand, ni secret, ni détail interne au-delà du SHA de commit déployé
 * (déjà public dans l'historique GitHub) et du statut brut de la connexion
 * base de données.
 *
 * Convention standard des sondes de santé : 200 si tout va bien, 503 sinon
 * — jamais un 200 qui masquerait une base de données inaccessible à un
 * moniteur externe qui ne lirait que le code HTTP.
 */
export async function GET() {
  const report = await computeHealth();
  return NextResponse.json(report, { status: report.status === "ok" ? 200 : 503 });
}
