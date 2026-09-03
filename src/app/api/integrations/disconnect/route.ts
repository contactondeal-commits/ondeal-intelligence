import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireStoreAccess, AuthError } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const { storeId, provider } = body ?? {};
  if (!storeId || !provider) return NextResponse.json({ error: "Champs manquants." }, { status: 400 });

  let userId: string;
  try {
    ({ userId } = await requireStoreAccess(storeId));
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }

  await prisma.integration.updateMany({
    where: { storeId, provider },
    data: { status: "NOT_CONNECTED", encryptedCredentials: null, lastError: null },
  });

  await logAudit({ storeId, userId, actorType: "user", event: "integration.disconnected", message: `Intégration ${provider} déconnectée.` });

  return NextResponse.json({ ok: true });
}
