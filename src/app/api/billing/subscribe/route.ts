import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireStoreAccess, requireRole, ADMIN_ROLES, AuthError } from "@/lib/auth";
import { getFreshShopifyCredentials } from "@/lib/integrations/shopify-token";
import { createAppSubscription, PLAN_PRICING, type PaidPlan } from "@/lib/integrations/shopify-billing";
import { logAudit } from "@/lib/audit";

const bodySchema = z
  .object({
    storeId: z.string().min(1).max(64),
    plan: z.enum(["PRO", "BUSINESS", "AGENCY"]),
  })
  .strict();

// COMMERCIALISATION — initie un changement de plan payant. Ne modifie
// JAMAIS Organization.plan directement : renvoie seulement l'URL de
// confirmation Shopify. Le plan n'est réellement activé qu'à réception du
// webhook app_subscriptions/update confirmant le statut ACTIVE — jamais
// anticipé côté app (voir /api/webhooks/shopify/app-subscription-update).
export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  const { storeId, plan } = parsed.data;

  try {
    const { userId, role } = await requireStoreAccess(storeId);
    requireRole(role, ADMIN_ROLES);

    const integration = await prisma.integration.findUnique({
      where: { storeId_provider: { storeId, provider: "SHOPIFY" } },
    });
    if (!integration || integration.status !== "CONNECTED" || !integration.encryptedCredentials) {
      return NextResponse.json(
        { error: "Connectez d'abord Shopify (Paramètres > Intégrations) : la facturation passe par l'API Shopify de votre boutique." },
        { status: 400 },
      );
    }

    // Rafraîchit un jeton EXPIRANT proche de l'échéance avant l'appel à
    // l'API Billing (04/09/2026 — correctif, voir shopify-token.ts) ; no-op
    // pour un jeton classique non-expirant.
    const creds = await getFreshShopifyCredentials(integration);
    const appUrl = process.env.APP_URL?.replace(/\/$/, "") ?? "";
    const returnUrl = `${appUrl}/settings?store=${storeId}&billing=return`;

    const { confirmationUrl, subscriptionId } = await createAppSubscription(creds, plan as PaidPlan, returnUrl);

    const store = await prisma.store.findUnique({ where: { id: storeId }, select: { organizationId: true } });
    if (store) {
      await prisma.organization.update({
        where: { id: store.organizationId },
        data: {
          billingProvider: "shopify",
          shopifySubscriptionId: subscriptionId,
          shopifySubscriptionStatus: "PENDING",
          shopifySubscriptionUpdatedAt: new Date(),
        },
      });
      await logAudit({
        storeId,
        userId,
        actorType: "user",
        event: "billing.subscription_requested",
        message: `Demande d'abonnement au plan ${plan} (${PLAN_PRICING[plan as PaidPlan]} EUR/mois) envoyée à Shopify — en attente d'approbation du marchand.`,
      });
    }

    return NextResponse.json({ ok: true, confirmationUrl });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 403 });
    console.error("[billing/subscribe] échec", { storeId, plan, error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: "Impossible de créer la demande d'abonnement auprès de Shopify pour le moment." }, { status: 502 });
  }
}
