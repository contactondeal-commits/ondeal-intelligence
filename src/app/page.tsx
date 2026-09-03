import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export default async function RootPage() {
  const ctx = await getCurrentUser();
  if (!ctx) redirect("/login");

  if (ctx.memberships.length === 0) redirect("/onboarding");

  const firstOrgId = ctx.memberships[0]!.organizationId;
  const store = await prisma.store.findFirst({ where: { organizationId: firstOrgId }, orderBy: { createdAt: "asc" } });

  if (!store) redirect("/onboarding");

  redirect(`/dashboard?store=${store.id}`);
}
