import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { canCreateStore } from "@/lib/plan-limits";
import { seedDemoStore } from "@/lib/demo/seedDemoStore";

const schema = z.object({
  mode: z.enum(["real", "demo"]),
  storeName: z.string().min(1).max(160).optional(),
  domain: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const ctx = await getCurrentUser();
  if (!ctx) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Champs invalides." }, { status: 400 });

  const organizationId = ctx.memberships[0]?.organizationId;
  if (!organizationId) return NextResponse.json({ error: "Aucune organisation associée à ce compte." }, { status: 400 });

  const limitCheck = await canCreateStore(organizationId);
  if (!limitCheck.allowed) return NextResponse.json({ error: limitCheck.reason }, { status: 403 });

  if (parsed.data.mode === "demo") {
    const storeId = await seedDemoStore(organizationId);
    return NextResponse.json({ ok: true, storeId });
  }

  const store = await prisma.store.create({
    data: {
      organizationId,
      name: parsed.data.storeName || "Ma boutique",
      domain: parsed.data.domain || null,
      isDemo: false,
    },
  });

  await logAudit({
    storeId: store.id,
    userId: ctx.user.id,
    actorType: "user",
    event: "store.created",
    message: `Boutique "${store.name}" créée.`,
  });

  return NextResponse.json({ ok: true, storeId: store.id });
}
