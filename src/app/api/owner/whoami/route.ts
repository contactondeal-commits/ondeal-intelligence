import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isPlatformOwner } from "@/lib/authz/capabilities";

/**
 * ONDEAL AI CORE — FINAL PHASE : auto-diagnostic Owner (06/09/2026).
 *
 * Problème réel rencontré en conditions réelles : `PLATFORM_OWNER_USER_IDS`
 * (variable d'environnement Vercel) attend un `User.id` Prisma exact —
 * jamais un email — mais jusqu'ici, aucune route ne permettait à l'Owner
 * de découvrir SA PROPRE valeur exacte sans une requête SQL directe en
 * production. Résultat concret : `/api/owner/webauthn/register/options`
 * renvoie honnêtement "Réservé au Platform Owner." (comportement correct)
 * mais sans aucun moyen, pour l'Owner lui-même, de savoir QUOI coller
 * dans la variable d'environnement pour corriger la situation.
 *
 * Cette route comble EXACTEMENT ce manque, sans rien affaiblir :
 *   - Exige une session applicative normale valide (comme toute route
 *     authentifiée) — 401 sinon, jamais un accès anonyme.
 *   - Ne renvoie JAMAIS l'identité d'un AUTRE utilisateur — uniquement
 *     `current.user.id`/`current.user.email` de l'appelant lui-même
 *     (équivalent direct d'un endpoint `/whoami` classique — GitHub,
 *     Stripe, etc. exposent tous ce même genre de route).
 *   - `isPlatformOwner` est calculé et renvoyé AUSSI dans le cas `false`
 *     (contrairement aux routes webauthn/* qui bloquent tout avec un
 *     403) — c'est tout le point : cette route doit rester utilisable
 *     PENDANT le diagnostic, avant que l'allowlist soit correcte.
 *   - N'accorde AUCUNE capacité Control Plane : c'est une lecture pure,
 *     jamais un contournement de `requireCapability`/`isPlatformOwner`
 *     ailleurs dans le dépôt.
 */
export async function GET() {
  const current = await getCurrentUser();
  if (!current) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });

  return NextResponse.json({
    userId: current.user.id,
    email: current.user.email,
    isPlatformOwner: isPlatformOwner(current.user.id),
  });
}
