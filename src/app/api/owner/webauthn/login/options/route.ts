import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isPlatformOwner } from "@/lib/authz/capabilities";
import { buildAuthenticationOptions } from "@/lib/authz/webauthn";

export async function POST() {
  const current = await getCurrentUser();
  if (!current) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (!isPlatformOwner(current.user.id)) return NextResponse.json({ error: "Réservé au Platform Owner." }, { status: 403 });

  try {
    const options = await buildAuthenticationOptions(current.user.id, "AUTHENTICATION");
    return NextResponse.json(options);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
