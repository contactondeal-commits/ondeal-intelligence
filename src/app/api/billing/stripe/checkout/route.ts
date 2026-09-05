import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireStoreAccess, requireRole, ADMIN_ROLES, AuthError } from "@/lib/auth";
import { createStripeCustomer, createCheckoutSession, isStripeConfigured, StripeApiError, type PaidPlan } from "@/lib/integrations/stripe-billing";
import { logAudit } from "@/lib/audit";

const bodySchema = z
  .object({
        storeId: z.string().min(1).max(64),
        plan: z.enum(["PRO", "BUSINESS", "AGENCY"]),
  })
  .strict();

// FACTURATION STRIPE (lot 11, 05/09/2026) — chemin de paiement indépendant
// de Shopify, ouvert à TOUTE organisation (quelle que soit sa plateforme
// catalogue, ou même aucune) : contrairement à /api/billing/subscribe
// (Shopify), aucune intégration connectée n'est requise ici. Ne modifie
// JAMAIS Organization.plan directement : renvoie seulement l'URL de la
// session Stripe Checkout, hébergée et confirmée par Stripe lui-même. Le
// plan n'est réellement activé qu'à réception du webhook Stripe confirmant
// un abonnement au statut actif — jamais anticipé ici (voir
// /api/webhooks/stripe).
export async function POST(req: NextRequest) {
    if (!isStripeConfigured()) {
          return NextResponse.json({ error: "Le paiement par carte bancaire n'est pas encore configuré." }, { status: 501 });
    }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
    const { storeId, plan } = parsed.data;

  try {
        const { userId, role } = await requireStoreAccess(storeId);
        requireRole(role, ADMIN_ROLES);

      const store = await prisma.store.findUnique({ where: { id: storeId }, select: { organizationId: true } });
        if (!store) return NextResponse.json({ error: "Boutique introuvable." }, { status: 404 });

      const [organization, user] = await Promise.all([
              prisma.organization.findUnique({ where: { id: store.organizationId }, select: { stripeCustomerId: true, name: true } }),
              prisma.user.findUnique({ where: { id: userId }, select: { email: true, name: true } }),
            ]);
        if (!organization || !user) return NextResponse.json({ error: "Organisation introuvable." }, { status: 404 });

      // Réutilise le Customer Stripe existant plutôt que d'en recréer un à
      // chaque paiement — évite de fragmenter l'historique de facturation du
      // marchand chez Stripe.
      let customerId = organization.stripeCustomerId;
        if (!customerId) {
                customerId = await createStripeCustomer({ organizationId: store.organizationId, email: user.email, name: organization.name });
                await prisma.organization.update({ where: { id: store.organizationId }, data: { stripeCustomerId: customerId } });
        }

      const appUrl = process.env.APP_URL?.replace(/\/$/, "") ?? "";
        const buildSession = (custId: string) =>
                createCheckoutSession({
                          customerId: custId,
                          plan: plan as PaidPlan,
                          successUrl: `${appUrl}/settings?store=${storeId}&billing=stripe_return`,
                          cancelUrl: `${appUrl}/settings?store=${storeId}`,
                });

      let checkoutUrl: string;
        try {
                ({ checkoutUrl } = await buildSession(customerId));
        } catch (err) {
                // Un Customer stocké a pu être créé sous une autre paire de clés Stripe
          // (typiquement : créé en mode test avant le passage en mode live —
          // incident réel du 05/09/2026, cf. STRIPE_SECRET_KEY corrigée le même
          // jour). Stripe le signale par "No such customer: ... a similar object
          // exists in test mode". Jamais planter dans ce cas précis : le Customer
          // stocké est ré-créé (dans le mode courant, celui de la clé secrète
          // active) et la session Checkout est retentée une seule fois — pas de
          // boucle, toute autre erreur Stripe remonte normalement.
          const isStaleCustomer = err instanceof StripeApiError && /No such customer/i.test(err.message);
                if (!isStaleCustomer) throw err;
                customerId = await createStripeCustomer({ organizationId: store.organizationId, email: user.email, name: organization.name });
                await prisma.organization.update({ where: { id: store.organizationId }, data: { stripeCustomerId: customerId } });
                ({ checkoutUrl } = await buildSession(customerId));
        }

      await logAudit({
              storeId,
              userId,
              actorType: "user",
              event: "billing.stripe_checkout_started",
              message: `Session de paiement par carte créée pour le plan ${plan} — en attente de confirmation Stripe.`,
      });

      return NextResponse.json({ ok: true, checkoutUrl });
  } catch (err) {
        if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 403 });
        console.error("[billing/stripe/checkout] échec", { storeId, plan, error: err instanceof Error ? err.message : String(err) });
        return NextResponse.json({ error: "Impossible de créer la session de paiement pour le moment." }, { status: 502 });
  }
}
