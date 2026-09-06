import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { isPlatformOwner } from "@/lib/authz/capabilities";
import { requireOwnerSession, OwnerAuthError } from "@/lib/authz/ownerSession";

/**
 * ONDEAL AI CORE — PHASE 5 : gate d'une PAGE (jamais une route API — voir
 * requireCapability pour ça) réservée au Platform Owner (06/09/2026).
 *
 * ÉTENDU (06/09/2026, "DELIVERY CONDITION — OWNER IDENTITY") : appartenir à
 * PLATFORM_OWNER_USER_IDS ne suffit PLUS à ouvrir /ai-lab — il faut EN PLUS
 * une PlatformOwnerSession valide (WebAuthn réussi, jamais révoquée) — voir
 * ownerSession.ts. Un Owner sans session valide (jamais enregistré de
 * passkey, session révoquée, ou nouvel appareil) est redirigé vers
 * /owner-auth pour compléter la cérémonie, JAMAIS laissé entrer sur la
 * seule foi de son rôle applicatif — "PLATFORM OWNER identity ne repose
 * jamais seulement sur email/password/env var/rôle" est donc vrai au niveau
 * du CODE ici, pas seulement de la documentation.
 */
export async function requirePlatformOwnerPage(): Promise<{ userId: string; email: string }> {
  const current = await getCurrentUser();
  if (!current) redirect("/login");
  if (!isPlatformOwner(current.user.id)) redirect("/dashboard");
  try {
    await requireOwnerSession(current.user.id);
  } catch (err) {
    if (err instanceof OwnerAuthError) redirect("/owner-auth");
    throw err;
  }
  return { userId: current.user.id, email: current.user.email };
}
