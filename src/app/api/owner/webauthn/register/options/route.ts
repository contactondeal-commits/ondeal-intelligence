import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isPlatformOwner } from "@/lib/authz/capabilities";
import { buildRegistrationOptions } from "@/lib/authz/webauthn";

// ONDEAL AI CORE — OWNER STRONG AUTH (06/09/2026). Bootstrap : l'utilisateur
// est déjà authentifié par la session applicative normale (email/password,
// auth.ts) ET figure dans PLATFORM_OWNER_USER_IDS — condition NÉCESSAIRE
// mais jamais SUFFISANTE pour accéder à AI Lab (voir requirePlatformOwnerPage).
// Cette route ne fait qu'émettre un challenge WebAuthn réel.
export async function POST() {
  const current = await getCurrentUser();
  if (!current) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (!isPlatformOwner(current.user.id)) return NextResponse.json({ error: "Réservé au Platform Owner." }, { status: 403 });

  try {
    const options = await buildRegistrationOptions(current.user.id, current.user.email);
    return NextResponse.json(options);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
