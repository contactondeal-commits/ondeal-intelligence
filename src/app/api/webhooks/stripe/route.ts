import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyStripeWebhookSignature, planFromPriceId, STRIPE_ACTIVE_STATUSES, type PaidPlan } from "@/lib/integrations/stripe-billing";
import { logAudit } from "@/lib/audit";

interface StripeSubscriptionEvent {
  type: string;
  data: {
    object: {
      id: string; // sub_...
      customer: string; // cus_...
      status: string;
      items?: { data: Array<{ price?: { id?: string } }> };
    };
  };
}

// FACTURATION STRIPE — webhook customer.subscription.*. SEUL point d'entrée
// qui active réellement un plan payant Stripe : le statut confirmé par
// Stripe ici, jamais anticipé côté app à la création de la session
// Checkout (voir /api/billing/stripe/checkout). Un statut hors
// active/trialing repasse l'organisation en plan STARTER — même discipline
// stricte que le webhook Shopify équivalent (app-subscription-update) :
// jamais de plan payant maintenu sans abonnement confirmé actif.
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("stripe-signature");
  if (!verifyStripeWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ error: "Signature invalide." }, { status: 401 });
  }

  let event: StripeSubscriptionEvent;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Corps de requête invalide." }, { status: 400 });
  }

  // Seuls les événements d'abonnement portent un statut exploitable pour
  // accorder/retirer un plan — checkout.session.completed est ignoré ici
  // à dessein : une session peut se compléter alors que l'abonnement Stripe
  // sous-jacent reste "incomplete" (ex. 3-D Secure en attente), ce qui
  // activerait un plan payant sans paiement réellement confirmé.
  if (!event.type?.startsWith("customer.subscription.")) {
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  const sub = event.data?.object;
  if (!sub?.id || !sub.customer || !sub.status) {
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  const organization = await prisma.organization.findFirst({
    where: { stripeCustomerId: sub.customer },
    include: { stores: { take: 1, orderBy: { createdAt: "asc" } } },
  });
  if (!organization) return NextResponse.json({ ok: true }, { status: 200 });

  // Ignore un événement pour un abonnement qui n'est plus celui en cours de
  // cette organisation (ex. ancien abonnement annulé puis un nouveau créé) —
  // sauf s'il n'y en avait aucun encore enregistré (premier abonnement).
  if (organization.stripeSubscriptionId && organization.stripeSubscriptionId !== sub.id) {
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  const priceId = sub.items?.data?.[0]?.price?.id ?? null;
  const matchedPlan: PaidPlan | null = priceId ? planFromPriceId(priceId) : null;
  const isActive = STRIPE_ACTIVE_STATUSES.has(sub.status);
  const newPlan = isActive && matchedPlan ? matchedPlan : "STARTER";

  await prisma.organization.update({
    where: { id: organization.id },
    data: {
      plan: newPlan,
      billingProvider: "stripe",
      stripeSubscriptionId: sub.id,
      stripeSubscriptionStatus: sub.status,
      stripeSubscriptionUpdatedAt: new Date(),
    },
  });

  // AuditLog est indexé par storeId : une organisation Stripe n'est pas
  // nécessairement rattachée à une boutique unique porteuse de sens (le
  // paiement est au niveau organisation) — la première boutique de
  // l'organisation sert de point d'ancrage, comme pour tout autre événement
  // système au niveau organisation.
  const anchorStoreId = organization.stores[0]?.id;
  if (anchorStoreId) {
    await logAudit({
      storeId: anchorStoreId,
      actorType: "system",
      event: "billing.subscription_updated",
      message: isActive
        ? `Abonnement Stripe confirmé actif — plan ${newPlan} activé.`
        : `Abonnement Stripe au statut ${sub.status} — organisation repassée au plan STARTER.`,
      meta: { subscriptionId: sub.id, status: sub.status, provider: "stripe" },
    });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
