import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { isPlatformOwner } from "@/lib/authz/capabilities";

/**
 * ONDEAL AI CORE — PHASE 5 : gate d'une PAGE (jamais une route API — voir
 * requireCapability pour ça) réservée au Platform Owner (06/09/2026).
 *
 * PREMIÈRE page Owner-only du frontend (grep confirmé : aucun précédent
 * dans src/app/**\/*.tsx avant AI Lab) — mêmes règles que
 * requireCapability("SYSTEM_CODER") (PLATFORM_OWNER_USER_IDS, jamais un
 * rôle Membership), mais avec un comportement de PAGE (redirect, jamais une
 * exception JSON) — cohérent avec store-context.ts::requireStore.
 *
 * Décision d'emplacement (voir rapport de session) : AI Lab vit HORS du
 * groupe (app) — (app)/layout.tsx impose implicitement `requireStore`
 * (store-scoped) sur chaque page qu'il contient, alors qu'AI Lab n'est
 * JAMAIS store-scoped par défaut (StorefrontMission.storeId est optionnel).
 */
export async function requirePlatformOwnerPage(): Promise<{ userId: string; email: string }> {
  const current = await getCurrentUser();
  if (!current) redirect("/login");
  if (!isPlatformOwner(current.user.id)) redirect("/dashboard");
  return { userId: current.user.id, email: current.user.email };
}
