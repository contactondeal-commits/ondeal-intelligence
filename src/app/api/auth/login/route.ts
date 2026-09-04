import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { verifyPassword, createSession, setSessionCookie } from "@/lib/auth";
import { rateLimit, clientIp } from "@/lib/rate-limit";

// Hash bcrypt (coût 12) d'une valeur aléatoire : comparé lorsque l'email est
// inconnu, pour que le temps de réponse ne révèle pas l'existence du compte.
const DUMMY_HASH = "$2a$12$/WXCzv8JKwN/VrXyuao.muWYpjZicAkvQFNn2BUwIq6DhKFLeNY56";

const schema = z.object({ email: z.string().email().max(254), password: z.string().min(1).max(128) });

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Email ou mot de passe invalide." }, { status: 400 });
  }

  // Anti-force brute : 10 tentatives / 15 min par IP et par email.
  const ip = clientIp(req);
  const byIp = rateLimit(`login:ip:${ip}`, { max: 30, windowMs: 15 * 60 * 1000 });
  const byEmail = rateLimit(`login:email:${parsed.data.email.toLowerCase()}`, { max: 10, windowMs: 15 * 60 * 1000 });
  if (!byIp.ok || !byEmail.ok) {
    const retry = Math.max(byIp.retryAfterSeconds, byEmail.retryAfterSeconds);
    return NextResponse.json({ error: "Trop de tentatives. Réessayez dans quelques minutes." }, { status: 429, headers: { "Retry-After": String(retry) } });
  }

  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  const valid = await verifyPassword(parsed.data.password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !valid) {
    return NextResponse.json({ error: "Identifiants incorrects." }, { status: 401 });
  }

  const token = await createSession({ userId: user.id, email: user.email });
  await setSessionCookie(token);

  return NextResponse.json({ ok: true });
}
