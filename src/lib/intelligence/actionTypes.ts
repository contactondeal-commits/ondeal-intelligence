/**
 * Types d'action "sensibles" — nécessitent toujours une confirmation humaine
 * explicite avant exécution (modification réelle de la boutique), quel que
 * soit le plan ou le rôle de l'utilisateur.
 *
 * Source unique partagée entre le serveur (API /api/actions) et le client
 * (DecisionCard) — évite la duplication qui existait auparavant entre la
 * route API et ActionRow.tsx, avec le risque que les deux listes divergent.
 * Aucune dépendance Node/Prisma ici : ce fichier est importable côté client.
 */
export const SENSITIVE_ACTION_TYPES = new Set([
  "update_price",
  "update_stock",
  "unpublish_product",
  "publish_product",
]);

export function isSensitiveActionType(type: string | null | undefined): boolean {
  return !!type && SENSITIVE_ACTION_TYPES.has(type);
}
