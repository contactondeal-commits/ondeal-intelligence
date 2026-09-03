import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireStoreAccess, AuthError } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rec = await prisma.recommendation.findUnique({ where: { id } });
  if (!rec) return NextResponse.json({ error: "Recommandation introuvable." }, { status: 404 });

  try {
    const { userId } = await requireStoreAccess(rec.storeId);
    await prisma.recommendation.update({ where: { id }, data: { status: "DISMISSED" } });
    await logAudit({
      storeId: rec.storeId,
      userId,
      actorType: "user",
      event: "recommendation.dismissed",
      message: `Recommandation ignorée : "${rec.title}".`,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }
}
