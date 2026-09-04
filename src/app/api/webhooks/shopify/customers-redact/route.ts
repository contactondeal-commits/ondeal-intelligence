import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyShopifyWebhookHmac } from "@/lib/integrations/shopify-oauth";
import { logAudit } from "@/lib/audit";

// WEBHOOK OBLIGATOIRE (conformité) — customers/redact. Reçu quand le
// marchand doit effacer les données d'un client (RGPD/CCPA). OrderLine ne
// porte aucune donnée nominative, donc rien à effacer à ce niveau. Les
// commandes explicitement visées (orders_to_redact) sont malgré tout
// supprimées par prudence — c'est la seule donnée réellement rattachable à
// ce client dans le modèle actuel. Effacement réel (pas une simulation) :
// exigence légale, exécuté uniquement après vérification HMAC.
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const hmac = req.headers.get("x-shopify-hmac-sha256");
  if (!verifyShopifyWebhookHmac(rawBody, hmac)) {
    return NextResponse.json({ error: "Signature invalide." }, { status: 401 });
  }

  const shopDomain = req.headers.get("x-shopify-shop-domain");
  let payload: { customer?: { id?: number }; orders_to_redact?: number[] } = {};
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Corps de requête invalide." }, { status: 400 });
  }

  const store = shopDomain ? await prisma.store.findFirst({ where: { domain: shopDomain } }) : null;
  if (store) {
    const orderIds = (payload.orders_to_redact ?? []).map(String);
    const deleted = orderIds.length
      ? await prisma.order.deleteMany({ where: { storeId: store.id, shopifyOrderId: { in: orderIds } } })
      : { count: 0 };

    await logAudit({
      storeId: store.id,
      actorType: "system",
      event: "compliance.customers_redact",
      message: `Demande de suppression de données client traitée : ${deleted.count} commande(s) supprimée(s). ` +
        "OnDeal ne stocke pas de données client nominatives (email/nom) en dehors des commandes visées.",
      meta: { customerId: payload.customer?.id, ordersRedacted: deleted.count },
    });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
