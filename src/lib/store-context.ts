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
  const store = requestedId ? allStores.find((s) => s.id === requestedId) : allStores[0];
  if (!store) redirect(`/dashboard?store=${allStores[0]!.id}`);

  const membership = ctx.memberships.find((m) => m.organizationId === store!.organizationId)!;
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: store!.organizationId } });

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
    allStores: allStores
      .filter((s) => s.organizationId === store!.organizationId || orgIds.includes(s.organizationId))
      .map((s) => ({ id: s.id, name: s.name, isDemo: s.isDemo })),
  };
}
