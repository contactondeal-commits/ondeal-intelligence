/**
 * FIABILITÉ DES SIGNAUX — mesure, sur l'historique réel des décisions prises
 * par l'utilisateur, la part des recommandations effectivement actionnées
 * (Recommendation.status === "ACTIONED", posé uniquement quand l'ActionItem
 * lié atteint EXECUTED — voir /api/actions/[id]/execute) contre celles
 * explicitement écartées (status === "DISMISSED", via /api/recommendations/
 * [id]/dismiss). Fonction pure, aucun accès base ici — l'appelant fournit
 * les compteurs déjà agrégés par la base (prisma.recommendation.groupBy).
 *
 * Volontairement exclu : le compteur "OPEN" (signaux actuellement ouverts).
 * Le pipeline (recomputeStoreIntelligence) supprime PUIS régénère toutes les
 * recommandations OPEN à chaque cycle de synchronisation — leur createdAt
 * est donc la date du DERNIER recalcul, pas la première apparition du
 * signal, et leur nombre à un instant T ne dit rien sur combien de cycles il
 * a fallu avant une décision. Mélanger ce compteur "instantané" avec les
 * compteurs ACTIONED/DISMISSED (qui eux s'accumulent honnêtement, un seul
 * enregistrement par décision réellement prise) fausserait le taux. Le taux
 * d'action ci-dessous ne porte donc que sur les recommandations pour
 * lesquelles une décision a réellement été prise — pas sur "tout ce qui a
 * jamais été affiché".
 */

export type ReliabilitySeverity = "URGENT" | "OPPORTUNITY" | "SUGGESTION";
export type DecidedStatus = "ACTIONED" | "DISMISSED";

export interface ReliabilityCountRow {
  severity: ReliabilitySeverity;
  status: DecidedStatus;
  count: number;
}

export interface ReliabilityBucket {
  actioned: number;
  dismissed: number;
  decided: number;
  /** null si aucune décision n'a encore été prise sur ce segment (rien à mesurer). */
  actionRate: number | null;
}

export interface ReliabilitySummary {
  overall: ReliabilityBucket;
  bySeverity: Record<ReliabilitySeverity, ReliabilityBucket>;
}

const SEVERITIES: ReliabilitySeverity[] = ["URGENT", "OPPORTUNITY", "SUGGESTION"];

function emptyBucket(): ReliabilityBucket {
  return { actioned: 0, dismissed: 0, decided: 0, actionRate: null };
}

function finalize(b: ReliabilityBucket): ReliabilityBucket {
  const decided = b.actioned + b.dismissed;
  return { ...b, decided, actionRate: decided > 0 ? b.actioned / decided : null };
}

export function computeActionReliability(rows: ReliabilityCountRow[]): ReliabilitySummary {
  const bySeverity: Record<ReliabilitySeverity, ReliabilityBucket> = {
    URGENT: emptyBucket(),
    OPPORTUNITY: emptyBucket(),
    SUGGESTION: emptyBucket(),
  };
  const overall = emptyBucket();

  for (const row of rows) {
    const bucket = bySeverity[row.severity];
    if (!bucket) continue; // sévérité inconnue — ignorée plutôt que de fausser le total
    if (row.status === "ACTIONED") {
      bucket.actioned += row.count;
      overall.actioned += row.count;
    } else {
      bucket.dismissed += row.count;
      overall.dismissed += row.count;
    }
  }

  const result: ReliabilitySummary = {
    overall: finalize(overall),
    bySeverity: {
      URGENT: finalize(bySeverity.URGENT),
      OPPORTUNITY: finalize(bySeverity.OPPORTUNITY),
      SUGGESTION: finalize(bySeverity.SUGGESTION),
    },
  };
  return result;
}

export { SEVERITIES };
