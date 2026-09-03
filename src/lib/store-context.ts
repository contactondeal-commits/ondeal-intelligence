import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import type { Role } from "@prisma/client";

export interface ResolvedStore {
  id: string;
  name: string;
  isDemo: boolean;
  currency: string;
  organizationId: string;
  organizationName: string;
  plan: string;
  userId: string;
  role: Role;
  allStores: Array<{ id: string; name: string; isDemo: boolean }>;
}

/**
 * Porte d'entrée unique pour toute page authentifiée : vérifie la session,
 * résout la boutique demandée (`?store=`) et VÉRIFIE que l'utilisateur y a
 * accès via son organisation — garantit l'isolation multi-tenant (PHASE 2 /
 * PHASE 18). Redirige proprement si non authentifié / boutique invalide.
 */
export async function requireStore(searchParams: { store?: string }): Promise<ResolvedStore> {
  const ctx = await getCurrentUser();
  if (!ctx) redirect("/login");
  if (ctx.memberships.length === 0) redirect("/onboarding");

  const orgIds = ctx.memberships.map((m) => m.organizationId);
  const allStores = await prisma.store.findMany({
    where: { organizationId: { in: orgIds } },
    orderBy: { createdAt: "asc" },
  });
  if (allStores.length === 0) redirect("/onboarding");

  const requestedId = searchParams.store;
  // Par défaut (sans ?store= dans l'URL), on privilégie une boutique réelle
  // plutôt que la boutique de démonstration, même si celle-ci a été créée
  // en premier (à l'onboarding).
  const defaultStore = allStores.find((s) => !s.isDemo) ?? allStores[0]!;
  const store = requestedId ? allStores.find((s) => s.id === requestedId) : defaultStore;
  if (!store) redirect(`/dashboard?store=${defaultStore.id}`);

  const membership = ctx.memberships.find((m) => m.organizationId === store!.organizationId)!;
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: store!.organizationId } });

  const accessibleStores = allStores.filter(
    (s) => s.organizationId === store!.organizationId || orgIds.includes(s.organizationId),
  );
  // Dès qu'une boutique réelle existe, on masque complètement la boutique de
  // démonstration du sélecteur : impossible de tomber dessus par erreur
  // (ex. pendant une démo/live devant un client).
  const hasRealStore = accessibleStores.some((s) => !s.isDemo);
  const visibleStores = hasRealStore ? accessibleStores.filter((s) => !s.isDemo) : accessibleStores;

  return {
    id: store!.id,
    name: store!.name,
    isDemo: store!.isDemo,
    currency: store!.currency,
    organizationId: store!.organizationId,
    organizationName: org.name,
    plan: org.plan,
    userId: ctx.user.id,
    role: membership.role,
    allStores: visibleStores.map((s) => ({ id: s.id, name: s.name, isDemo: s.isDemo })),
  };
}
