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
  // CORRECTIF 05/09/2026 v4 — "set_product_status" : action manuelle
  // unifiée (Archiver / Mettre en brouillon / Republier), voir
  // /api/products/[id]/status. Distincte de "unpublish_product" (qui reste
  // réservé au moteur de recommandations automatique, toujours vers DRAFT)
  // pour ne jamais faire dépendre le choix manuel du marchand (n'importe
  // lequel des 3 statuts Shopify) de la sémantique plus étroite de ce type
  // historique.
  "set_product_status",
]);

export function isSensitiveActionType(type: string | null | undefined): boolean {
  return !!type && SENSITIVE_ACTION_TYPES.has(type);
}
