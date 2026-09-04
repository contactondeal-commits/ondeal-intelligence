import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireStoreAccess, requireRole, WRITE_ROLES, AuthError } from "@/lib/auth";
import { syncShopify, syncJudgeme } from "@/lib/sync/pipeline";

// Une synchronisation encore marquée "running" depuis moins de 15 min bloque
// tout nouveau lancement (protection quota Shopify / temps d'exécution).
const RUNNING_GUARD_MS = 15 * 60 * 1000;

export async function POST(req: NextRequest) {
  const parsed = z.object({ storeId: z.string().min(1).max(64) }).strict().safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "storeId requis." }, { status: 400 });
  const storeId = parsed.data.storeId;

  try {
    const { role } = await requireStoreAccess(storeId);
    requireRole(role, WRITE_ROLES);
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }

  const running = await prisma.syncRun.findFirst({ where: { storeId, status: "running", startedAt: { gte: new Date(Date.now() - RUNNING_GUARD_MS) } }, select: { id: true } });
  if (running) return NextResponse.json({ error: "Une synchronisation est déjà en cours pour cette boutique." }, { status: 409 });

  const [shopify, judgeme] = await Promise.all([
    syncShopify(storeId, "manual"),
    syncJudgeme(storeId, "manual"),
  ]);

  return NextResponse.json({ ok: true, shopify, judgeme });
}
