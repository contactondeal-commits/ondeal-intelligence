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

/**
 * FINAL PHASE — Merchant Plane entitlements, intégrité réelle (06/09/2026).
 *
 * Audit réel de chaque entrée de PLAN_FEATURES (grep sur tout `src/app` —
 * jamais une supposition) : "automations", "reports", "suppliers", "api",
 * "team" et "agency_workspace" figurent dans la liste de PRO/BUSINESS/
 * AGENCY, mais AUCUNE page ni route ne les vérifie jamais avec
 * `hasFeature()` — parce qu'aucune fonctionnalité correspondante n'existe
 * encore dans le dépôt (pas de page /suppliers, /reports ou /agency, pas
 * d'API publique marchande, pas de flux d'invitation d'équipe réel —
 * Settings l'indique déjà honnêtement : "L'invitation de membres n'est pas
 * encore disponible dans cette version.").
 *
 * Jusqu'ici, Settings › Votre plan actuel affichait CES MÊMES libellés
 * comme des puces "actives" pour un marchand BUSINESS/AGENCY (et
 * "automations"/"reports" dès PRO) — une organisation payante voyait donc
 * une fonctionnalité annoncée comme incluse alors qu'elle n'existe
 * littéralement nulle part dans l'application. Ce n'est pas un défaut
 * d'application (rien à bloquer, aucune route à gater) mais un défaut
 * d'INTÉGRITÉ D'AFFICHAGE — même principe que "NO CAPABILITY THEATER"
 * appliqué à l'UI marchande plutôt qu'au backend IA.
 *
 * Décision : ne PAS retirer ces entrées de PLAN_FEATURES (elles restent
 * l'intention produit réelle pour ces plans, jamais perdue) — seulement
 * cesser de les présenter comme déjà actives. `hasFeature()` reste
 * inchangé (un futur appelant réel pourra toujours l'utiliser le jour où
 * la fonctionnalité existe). Seul l'AFFICHAGE (Settings) doit distinguer
 * "inclus et déjà utilisable" de "inclus au tarif, pas encore construit".
 */
export const UNBUILT_FEATURES: ReadonlySet<string> = new Set(["automations", "reports", "suppliers", "api", "team", "agency_workspace"]);

export function isFeatureBuilt(feature: string): boolean {
  return !UNBUILT_FEATURES.has(feature);
}

/**
 * Features listées dans PLAN_FEATURES qui SONT réellement appliquées, mais
 * jamais via `hasFeature()` — un autre mécanisme réel les fait déjà
 * respecter, donc un `hasFeature(plan, "x")` explicite ne serait que du
 * code mort qui ne se déclencherait jamais. Documenté ici plutôt que
 * silencieusement absent, pour que tests/planFeatureIntegrity.test.ts
 * (scan réel de src/app) sache exactement quoi attendre :
 *
 *   - "multi_store" : PlanLimit.maxStores (STARTER/PRO = 1) rend la
 *     création d'une 2e boutique littéralement impossible via
 *     canCreateStore()/onboarding — aucune 2e boutique n'existe jamais à
 *     gater séparément pour ces plans.
 */
export const FEATURES_ENFORCED_BY_OTHER_MEANS: ReadonlySet<string> = new Set(["multi_store"]);

/**
 * Résout le plan de l'organisation propriétaire d'une boutique — utilisé
 * pour vérifier CÔTÉ SERVEUR (jamais seulement dans l'UI) qu'une route
 * mutative correspond bien au plan payant réel de l'organisation (audit
 * conformité 05/09/2026). "STARTER" en repli si l'organisation est
 * introuvable — n'autorise jamais par défaut une fonctionnalité premium.
 */
export async function planForStore(storeId: string): Promise<string> {
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { organization: { select: { plan: true } } },
  });
  return store?.organization.plan ?? "STARTER";
}
