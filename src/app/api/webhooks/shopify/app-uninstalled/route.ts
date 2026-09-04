import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyShopifyWebhookHmac } from "@/lib/integrations/shopify-oauth";
import { logAudit } from "@/lib/audit";

// Webhook opérationnel (non obligatoire pour la conformité, mais bonne
// pratique standard) — app/uninstalled. Reflète immédiatement la
// désinstallation (statut de l'intégration) sans attendre le shop/redact
// (48h plus tard, qui lui efface réellement les données — voir shop-redact/route.ts).
// Ne supprime AUCUNE donnée ici : seulement le statut.
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const hmac = req.headers.get("x-shopify-hmac-sha256");
  if (!verifyShopifyWebhookHmac(rawBody, hmac)) {
    return NextResponse.json({ error: "Signature invalide." }, { status: 401 });
  }

  const shopDomain = req.headers.get("x-shopify-shop-domain");
  const store = shopDomain ? await prisma.store.findFirst({ where: { domain: shopDomain } }) : null;
  if (store) {
    await prisma.integration.updateMany({
      where: { storeId: store.id, provider: "SHOPIFY" },
      data: { status: "NOT_CONNECTED", lastError: "Application désinstallée depuis Shopify." },
    });
    await logAudit({
      storeId: store.id,
      actorType: "system",
      event: "integration.uninstalled",
      message: "Application désinstallée depuis l'admin Shopify. Les données restent conservées 48h avant effacement (shop/redact).",
    });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
