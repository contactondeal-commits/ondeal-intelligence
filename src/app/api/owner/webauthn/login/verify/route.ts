import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { isPlatformOwner } from "@/lib/authz/capabilities";
import { verifyAuthentication } from "@/lib/authz/webauthn";
import { createOwnerSession } from "@/lib/authz/ownerSession";
import { appendAuditLog } from "@/lib/ai/policy/audit";
import { rateLimit, clientIp } from "@/lib/rate-limit";

const bodySchema = z.object({ response: z.unknown() }).strict();

export async function POST(req: NextRequest) {
  const current = await getCurrentUser();
  if (!current) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (!isPlatformOwner(current.user.id)) return NextResponse.json({ error: "Réservé au Platform Owner." }, { status: 403 });

  const ip = clientIp(req);
  const limited = await rateLimit(`owner-webauthn-login:${ip}`, { max: 20, windowMs: 15 * 60 * 1000 });
  if (!limited.ok) return NextResponse.json({ error: "Trop de tentatives." }, { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Paramètres invalides." }, { status: 400 });

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { credentialId } = await verifyAuthentication(current.user.id, parsed.data.response as any, "AUTHENTICATION");
    await createOwnerSession(current.user.id, credentialId);
    await appendAuditLog({ actorUserId: current.user.id, action: "owner.session_opened", reason: "Connexion Platform Owner par passkey WebAuthn réussie.", resultStatus: "SUCCESS" });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await appendAuditLog({ actorUserId: current.user.id, action: "owner.session_open_failed", reason: message, resultStatus: "FAILURE" });
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
