import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { requireStoreAccess, requireRole, ADMIN_ROLES, AuthError } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

export async function POST(req: NextRequest) {
  const parsed = z
    .object({ storeId: z.string().min(1).max(64), provider: z.enum(["SHOPIFY", "JUDGEME", "WOOCOMMERCE", "PRESTASHOP", "CJDROPSHIPPING", "GOOGLE_ANALYTICS"]) })
    .strict()
    .safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Champs manquants ou invalides." }, { status: 400 });
  const { storeId, provider } = parsed.data;

  let userId: string;
  try {
    const access = await requireStoreAccess(storeId);
    userId = access.userId;
    requireRole(access.role, ADMIN_ROLES);
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
