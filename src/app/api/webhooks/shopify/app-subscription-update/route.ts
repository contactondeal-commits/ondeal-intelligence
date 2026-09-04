import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyShopifyWebhookHmac } from "@/lib/integrations/shopify-oauth";
import { planFromSubscriptionName } from "@/lib/integrations/shopify-billing";
import { logAudit } from "@/lib/audit";

// COMMERCIALISATION — webhook app_subscriptions/update. SEUL point d'entrée
// qui active réellement un plan payant : le statut ACTIVE confirmé par
// Shopify ici, jamais anticipé côté app au moment de la demande (voir
// /api/billing/subscribe). Un statut CANCELLED/EXPIRED/FROZEN/DECLINED
// repasse l'organisation en plan STARTER (dégradation immédiate, jamais de
// plan payant maintenu sans abonnement actif confirmé par Shopify).
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const hmac = req.headers.get("x-shopify-hmac-sha256");
  if (!verifyShopifyWebhookHmac(rawBody, hmac)) {
    return NextResponse.json({ error: "Signature invalide." }, { status: 401 });
  }

  let payload: { app_subscription?: { admin_graphql_api_id?: string; name?: string; status?: string } } = {};
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Corps de requête invalide." }, { status: 400 });
  }

  const sub = payload.app_subscription;
  const shopDomain = req.headers.get("x-shopify-shop-domain");
  if (!sub?.admin_graphql_api_id || !sub.status || !shopDomain) {
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  const store = await prisma.store.findFirst({ where: { domain: shopDomain }, select: { id: true, organizationId: true } });
  if (!store) return NextResponse.json({ ok: true }, { status: 200 });

  const organization = await prisma.organization.findUnique({ where: { id: store.organizationId } });
  // Ignore les mises à jour d'un abonnement qui n'est plus celui en cours
  // pour cette organisation (ex. ancienne demande annulée puis relancée).
  if (!organization || organization.shopifySubscriptionId !== sub.admin_graphql_api_id) {
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  const status = sub.status.toUpperCase();
  const matchedPlan = sub.name ? planFromSubscriptionName(sub.name) : null;
  const newPlan = status === "ACTIVE" && matchedPlan ? matchedPlan : "STARTER";

  await prisma.organization.update({
    where: { id: organization.id },
    data: {
      plan: newPlan,
      shopifySubscriptionStatus: status,
      shopifySubscriptionUpdatedAt: new Date(),
    },
  });

  await logAudit({
    storeId: store.id,
    actorType: "system",
    event: "billing.subscription_updated",
    message:
      status === "ACTIVE"
        ? `Abonnement Shopify confirmé actif — plan ${newPlan} activé.`
        : `Abonnement Shopify au statut ${status} — organisation repassée au plan STARTER.`,
    meta: { subscriptionId: sub.admin_graphql_api_id, status },
  });

  return NextResponse.json({ ok: true }, { status: 200 });
}
