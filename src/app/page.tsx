import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export default async function RootPage() {
  const ctx = await getCurrentUser();
  if (!ctx) redirect("/login");

  if (ctx.memberships.length === 0) redirect("/onboarding");

  const firstOrgId = ctx.memberships[0]!.organizationId;
  const stores = await prisma.store.findMany({ where: { organizationId: firstOrgId }, orderBy: { createdAt: "asc" } });

  if (stores.length === 0) redirect("/onboarding");

  // Priorise une boutique réelle sur la boutique de démonstration si les deux
  // existent, même si la démo a été créée en premier (à l'onboarding).
  const store = stores.find((s) => !s.isDemo) ?? stores[0]!;

  redirect(`/dashboard?store=${store.id}`);
}
