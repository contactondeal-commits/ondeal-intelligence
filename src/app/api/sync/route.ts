import { NextRequest, NextResponse } from "next/server";
import { requireStoreAccess, AuthError } from "@/lib/auth";
import { syncShopify, syncJudgeme } from "@/lib/sync/pipeline";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const storeId = body?.storeId as string | undefined;
  if (!storeId) return NextResponse.json({ error: "storeId requis." }, { status: 400 });

  try {
    await requireStoreAccess(storeId);
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }

  const [shopify, judgeme] = await Promise.all([
    syncShopify(storeId, "manual"),
    syncJudgeme(storeId, "manual"),
  ]);

  return NextResponse.json({ ok: true, shopify, judgeme });
}
