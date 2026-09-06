import { getCurrentUser } from "@/lib/auth";

/**
 * ONDEAL AI CORE — Control Plane / Merchant Plane, fondation (06/09/2026).
 *
 * Frontière imposée SERVER-SIDE, jamais seulement côté UI (voir la
 * commande "OWNER CONTROL PLANE" reçue pendant PHASE 2) : un Role.OWNER
 * Prisma (propriétaire d'UNE organisation cliente — voir
 * Membership.role, src/lib/auth.ts) N'IMPLIQUE JAMAIS un accès Control
 * Plane. "STORE ADMIN ≠ ONDEAL OWNER" — ce sont deux concepts distincts,
 * jamais mélangés dans cette fondation :
 *
 *   - MERCHANT PLANE (rôle métier : OWNER/ADMIN/ANALYST/VIEWER d'une
 *     organisation cliente) : voir requireStoreAccess/requireRole,
 *     src/lib/auth.ts — inchangé, c'est le gate existant de toutes les
 *     routes qui manipulent LA donnée d'UNE boutique.
 *   - CONTROL PLANE (administration d'OnDeal lui-même — Model Router,
 *     évaluation multi-modèles, futur Coder Agent/Sandbox/Registry admin) :
 *     gouverné ICI, par une identité utilisateur PLATEFORME explicite
 *     (PLATFORM_OWNER_USER_IDS), jamais par un rôle métier, quel qu'il soit.
 *
 * Fondation délibérément MINIMALE : seulement les 2 capacités
 * RÉELLEMENT consommées aujourd'hui (les routes model-evaluations,
 * PHASE 2) — pas une matrice de 20+ capacités spéculatives (voir la
 * commande elle-même : "ne crée pas inutilement 30 permissions
 * aujourd'hui... construis une foundation extensible"). Chaque capacité
 * supplémentaire s'ajoute le jour où un appelant réel en a besoin — même
 * principe que ModelProvider (providers/provider.ts) ou VerificationHook
 * (jobs/types.ts). La matrice Plan/Entitlement (STARTER/PRO/BUSINESS/
 * AGENCY → quelles capacités marchandes) et le Tool Registry
 * (riskLevel/requiredCapabilities par outil/Job type) restent un chantier
 * séparé, explicitement PAS construit ici — voir le rapport de session.
 */
export type Capability = "AI_MODEL_ADMIN" | "AI_EVAL_READ";

const ALL_CONTROL_PLANE_CAPABILITIES: ReadonlySet<Capability> = new Set(["AI_MODEL_ADMIN", "AI_EVAL_READ"]);

export class CapabilityError extends Error {}

function platformOwnerUserIds(): ReadonlySet<string> {
  const raw = process.env.PLATFORM_OWNER_USER_IDS ?? "";
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

/**
 * true UNIQUEMENT si `userId` figure dans l'allowlist plateforme explicite
 * (variable d'environnement, jamais une colonne "role" métier) — voir
 * .env.example. Aucun rôle Membership, aussi élevé soit-il (OWNER d'une
 * organisation cliente y compris), ne fait jamais de ce test un succès.
 */
export function isPlatformOwner(userId: string): boolean {
  return platformOwnerUserIds().has(userId);
}

/**
 * Gate Control Plane : vérifie la session RÉELLE de l'utilisateur courant
 * (jamais un storeId, jamais un rôle métier passé en paramètre) et exige
 * qu'il soit le propriétaire plateforme OnDeal pour posséder `capability`.
 * Lève CapabilityError (jamais un succès silencieux) sinon.
 */
export async function requireCapability(capability: Capability): Promise<{ userId: string; email: string }> {
  const current = await getCurrentUser();
  if (!current) throw new CapabilityError("Non authentifié.");

  const granted = isPlatformOwner(current.user.id) ? ALL_CONTROL_PLANE_CAPABILITIES : new Set<Capability>();
  if (!granted.has(capability)) {
    throw new CapabilityError(
      `Capacité Control Plane "${capability}" refusée — réservée au propriétaire plateforme OnDeal, indépendamment de tout rôle sur une boutique.`,
    );
  }
  return { userId: current.user.id, email: current.user.email };
}
