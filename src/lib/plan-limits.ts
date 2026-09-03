import { prisma } from "@/lib/db";

/**
 * PHASE 22 — vérifie qu'une organisation peut encore créer une ressource
 * selon son plan. Utilisé avant toute création de boutique/membre pour que
 * les limites soient réellement appliquées, pas seulement documentées.
 */
export async function canCreateStore(organizationId: string): Promise<{ allowed: boolean; reason?: string }> {
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, include: { stores: true } });
  if (!org) return { allowed: false, reason: "Organisation introuvable." };
  const limit = await prisma.planLimit.findUnique({ where: { plan: org.plan } });
  if (!limit) return { allowed: true }; // pas de limite configurée = pas de blocage
  if (org.stores.length >= limit.maxStores) {
    return {
      allowed: false,
      reason: `Le plan ${org.plan} est limité à ${limit.maxStores} boutique(s). Passez à un plan supérieur pour en connecter davantage.`,
    };
  }
  return { allowed: true };
}

export async function canAddMember(organizationId: string): Promise<{ allowed: boolean; reason?: string }> {
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, include: { memberships: true } });
  if (!org) return { allowed: false, reason: "Organisation introuvable." };
  const limit = await prisma.planLimit.findUnique({ where: { plan: org.plan } });
  if (!limit) return { allowed: true };
  if (org.memberships.length >= limit.maxUsers) {
    return {
      allowed: false,
      reason: `Le plan ${org.plan} est limité à ${limit.maxUsers} utilisateur(s). Passez à un plan supérieur pour inviter plus de membres.`,
    };
  }
  return { allowed: true };
}

// Fonctionnalités activées par plan — contrôle l'affichage/accès des
// modules avancés (PHASE 22). Vérifié côté serveur dans chaque route/page
// concernée, pas seulement masqué côté UI.
export const PLAN_FEATURES: Record<string, string[]> = {
  STARTER: ["dashboard", "stock", "reviews", "recommendations", "alerts"],
  PRO: ["dashboard", "stock", "reviews", "recommendations", "alerts", "pricing", "marketing", "assistant", "automations", "reports"],
  BUSINESS: [
    "dashboard", "stock", "reviews", "recommendations", "alerts", "pricing", "marketing", "assistant",
    "automations", "reports", "multi_store", "suppliers", "advanced_automations", "api", "audit_log", "team",
  ],
  AGENCY: [
    "dashboard", "stock", "reviews", "recommendations", "alerts", "pricing", "marketing", "assistant",
    "automations", "reports", "multi_store", "suppliers", "advanced_automations", "api", "audit_log", "team", "agency_workspace",
  ],
};

export function hasFeature(plan: string, feature: string): boolean {
  return PLAN_FEATURES[plan]?.includes(feature) ?? false;
}
