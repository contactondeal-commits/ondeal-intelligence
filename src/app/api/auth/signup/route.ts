import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { hashPassword, createSession, setSessionCookie } from "@/lib/auth";

const schema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email(),
  password: z.string().min(8, "8 caractères minimum."),
  organizationName: z.string().min(1).max(160),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Champs invalides." }, { status: 400 });
  }
  const { name, email, password, organizationName } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: "Un compte existe déjà avec cet email." }, { status: 409 });
  }

  const passwordHash = await hashPassword(password);

  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({ data: { name, email, passwordHash } });
    const organization = await tx.organization.create({ data: { name: organizationName, plan: "STARTER" } });
    await tx.membership.create({ data: { userId: user.id, organizationId: organization.id, role: "OWNER" } });
    return { user, organization };
  });

  // Le journal d'audit (AuditLog) est indexé par storeId : aucune boutique
  // n'existe encore à ce stade. Le premier événement journalisé sera
  // "store.created" lors de l'onboarding (voir /api/onboarding).

  const token = await createSession({ userId: result.user.id, email: result.user.email });
  await setSessionCookie(token);

  return NextResponse.json({ ok: true, organizationId: result.organization.id });
}
