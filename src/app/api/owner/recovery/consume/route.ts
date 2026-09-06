import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { verifyPassword } from "@/lib/auth";
import { isPlatformOwner } from "@/lib/authz/capabilities";
import { consumeRecoveryCode, remainingRecoveryCodeCount } from "@/lib/authz/recovery";
import { createOwnerSession } from "@/lib/authz/ownerSession";
import { appendAuditLog } from "@/lib/ai/policy/audit";
import { rateLimit, clientIp } from "@/lib/rate-limit";

/**
 * §"second recovery factor" : chemin de secours quand l'authenticator
 * WebAuthn est perdu — exige DEUX preuves indépendantes (mot de passe du
 * compte applicatif + un code de récupération à usage unique), jamais une
 * seule. La session ouverte ici est volontairement L2_PASSKEY (pas
 * step-up) : le client DOIT enregistrer une nouvelle clé avant toute action
 * sensible (§"AI LAB" affiche un bandeau tant que recoveryCodesRemaining
 * a chuté après cet appel, poussant à ré-enregistrer une clé au plus vite).
 */
const bodySchema = z.object({ email: z.string().email(), password: z.string().min(1).max(128), code: z.string().min(1).max(20) }).strict();

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const limited = await rateLimit(`owner-recovery:${ip}`, { max: 10, windowMs: 60 * 60 * 1000 });
  if (!limited.ok) return NextResponse.json({ error: "Trop de tentatives." }, { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Paramètres invalides." }, { status: 400 });

  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  const validPassword = user ? await verifyPassword(parsed.data.password, user.passwordHash) : false;
  if (!user || !validPassword || !isPlatformOwner(user.id)) {
    return NextResponse.json({ error: "Identifiants ou code de récupération invalides." }, { status: 401 });
  }

  const consumed = await consumeRecoveryCode(user.id, parsed.data.code);
  if (!consumed) {
    await appendAuditLog({ actorUserId: user.id, action: "owner.recovery_failed", reason: "Code de récupération invalide ou déjà utilisé.", resultStatus: "FAILURE" });
    return NextResponse.json({ error: "Identifiants ou code de récupération invalides." }, { status: 401 });
  }

  // credentialId synthétique "RECOVERY" — traçable dans l'audit/les sessions
  // actives, jamais confondu avec une vraie clé WebAuthn.
  await createOwnerSession(user.id, "RECOVERY");
  const remaining = await remainingRecoveryCodeCount(user.id);
  await appendAuditLog({ actorUserId: user.id, action: "owner.recovery_used", reason: `Connexion Owner via code de récupération (secours) — ${remaining} code(s) restant(s).`, resultStatus: "SUCCESS" });

  return NextResponse.json({ ok: true, recoveryCodesRemaining: remaining, mustRegisterNewKey: true });
}
