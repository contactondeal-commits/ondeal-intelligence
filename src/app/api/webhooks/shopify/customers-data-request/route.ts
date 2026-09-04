import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyShopifyWebhookHmac } from "@/lib/integrations/shopify-oauth";
import { logAudit } from "@/lib/audit";

// WEBHOOK OBLIGATOIRE (conformité Shopify App Store) — customers/data_request.
// Reçu quand un client demande à voir les données que l'app détient sur lui.
// IMPORTANT : le modèle de données OnDeal ne stocke AUCUNE donnée client
// nominative (Order/OrderLine ne contiennent ni email ni nom de client — voir
// prisma/schema.prisma). Ce webhook est donc, pour l'état actuel du produit,
// un accusé de réception honnête : aucune donnée personnelle n'est détenue,
// donc aucune n'est retournée. Consigné en audit pour traçabilité, avec le
// détail de la demande, à disposition du marchand s'il doit répondre au client.
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const hmac = req.headers.get("x-shopify-hmac-sha256");
  if (!verifyShopifyWebhookHmac(rawBody, hmac)) {
    return NextResponse.json({ error: "Signature invalide." }, { status: 401 });
  }

  const shopDomain = req.headers.get("x-shopify-shop-domain");
  let payload: { customer?: { id?: number; email?: string }; orders_requested?: number[] } = {};
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Corps de requête invalide." }, { status: 400 });
  }

  const store = shopDomain ? await prisma.store.findFirst({ where: { domain: shopDomain } }) : null;
  if (store) {
    await logAudit({
      storeId: store.id,
      actorType: "system",
      event: "compliance.customers_data_request",
      message:
        "Demande d'accès aux données client reçue (Shopify). OnDeal ne stocke aucune donnée client " +
        "nominative (email/nom) — aucune donnée personnelle à transmettre.",
      meta: { customerId: payload.customer?.id, ordersRequested: payload.orders_requested ?? [] },
    });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
