import type { ActionStatus } from "@prisma/client";

/**
 * Boucle de décision — logique pure partagée entre le serveur et le client.
 *
 * Ne remplace ni ne duplique le moteur d'exécution existant
 * (/api/actions, /api/actions/[id]/confirm, /api/actions/[id]/execute) :
 * ces fonctions servent uniquement à (1) reprendre proprement une décision
 * déjà entamée au lieu d'en recréer une en double, et (2) présenter
 * clairement le cas où l'exécution a été refusée parce que la simulation
 * était devenue obsolète (voir `snapshot.ts`).
 *
 * Machine d'état : aucun nouvel enum Prisma n'a été ajouté. `ActionStatus`
 * reste PENDING_VALIDATION | CONFIRMED | EXECUTED | FAILED | CANCELLED.
 * "EXECUTING" est un état transitoire purement client (le booléen `busy`
 * pendant l'appel réseau) — il n'a pas besoin d'exister en base, il dure le
 * temps d'une requête. "Données obsolètes" n'est pas non plus un nouveau
 * statut en base : une exécution refusée pour cause de snapshot périmé
 * termine l'ActionItem en FAILED (comme tout autre échec — le comportement
 * de reprise existant s'applique déjà), avec un `resultJson.kind ===
 * "stale_simulation"` qui permet à l'UI de dériver une phase d'affichage
 * "stale" distincte d'un échec ordinaire, sans dupliquer un état déjà
 * représenté fidèlement par FAILED. C'est la solution la plus simple
 * cohérente avec l'existant, conformément à la consigne de ne pas ajouter un
 * état seulement si une solution plus simple existe déjà.
 */

export type DecisionPhase = "signal" | "confirm" | "ready-execute" | "stale" | "done-success" | "done-failed";

export interface ExistingActionLike {
  status: ActionStatus;
  sensitivity: "SENSITIVE" | "SAFE";
  /** resultJson brut de l'ActionItem — seulement nécessaire pour distinguer un échec ordinaire d'une simulation devenue obsolète. */
  resultJson?: string | null;
}

/** Détecte si le résultat d'une exécution échouée correspond à un refus pour cause de simulation obsolète (voir `snapshot.ts` / `actionKind.ts`). */
export function isStaleResult(resultJson: string | null | undefined): boolean {
  if (!resultJson) return false;
  try {
    const parsed = JSON.parse(resultJson) as { kind?: string };
    return parsed.kind === "stale_simulation";
  } catch {
    return false;
  }
}

/**
 * Dérive la phase d'affichage de la Decision Card à partir de l'ActionItem
 * le plus récent déjà existant pour cette recommandation, s'il y en a un.
 * Sans cette reprise, recharger la page (ou revenir plus tard) sur une
 * recommandation déjà préparée permettrait de cliquer à nouveau sur
 * « Décider » et de créer une deuxième ActionItem pour la même décision.
 */
export function derivePhaseFromExistingAction(action: ExistingActionLike | null): DecisionPhase {
  if (!action) return "signal";
  switch (action.status) {
    case "PENDING_VALIDATION":
      // Une action SAFE ne nécessite aucune confirmation humaine (déjà le
      // comportement du moteur d'exécution) : elle est directement prête à
      // exécuter. Une action SENSITIVE reprend à l'étape de confirmation.
      return action.sensitivity === "SENSITIVE" ? "confirm" : "ready-execute";
    case "CONFIRMED":
      return "ready-execute";
    case "EXECUTED":
      return "done-success";
    case "FAILED":
      return isStaleResult(action.resultJson) ? "stale" : "done-failed";
    case "CANCELLED":
    default:
      return "signal";
  }
}

/**
 * Vérifie que le prix local connu au moment de l'exécution correspond bien
 * à celui utilisé pour la simulation/décision — repli utilisé uniquement
 * pour les ActionItem plus anciennes qui n'ont pas encore de
 * `simulationSnapshot` complet (voir `snapshot.ts` pour la vérification
 * multi-champs qui la remplace pour toute nouvelle décision). Une tolérance
 * d'un centime absorbe les seules imprécisions flottantes, pas un vrai écart.
 */
export function isPriceStale(expectedPrice: number | null, currentPrice: number | null, toleranceCents = 1): boolean {
  if (expectedPrice === null || currentPrice === null) return false;
  return Math.abs(expectedPrice - currentPrice) * 100 > toleranceCents;
}
