import type { ShopifyCredentials } from "@/lib/integrations/shopify";
import { ShopifyApiError } from "@/lib/integrations/shopify";

// COMMERCIALISATION — Shopify Billing API (appSubscriptionCreate). Seule
// méthode de facturation autorisée par les règles du Shopify App Store pour
// un abonnement récurrent : aucune intégration Stripe/paiement externe ici.
// AUCUNE charge n'est jamais créée sans un appel explicite du marchand
// depuis l'app (bouton "Passer au plan X") : ce module ne fait qu'émettre la
// demande à Shopify, qui affiche ensuite SA PROPRE page de confirmation —
// c'est le marchand, jamais OnDeal, qui approuve la charge.
const API_VERSION = "2025-01";

export type PaidPlan = "PRO" | "BUSINESS" | "AGENCY";

// Prix mensuels EUR décidés par l'exploitant du produit (04/09/2026) — à
// ajuster ici uniquement si les tarifs changent réellement, jamais à
// deviner. STARTER reste gratuit, donc hors Billing API.
export const PLAN_PRICING: Record<PaidPlan, number> = {
  PRO: 14.9,
  BUSINESS: 49.9,
  AGENCY: 99,
};

function isTestMode(): boolean {
  // En développement/preview, toute charge créée est marquée test:true
  // (aucun débit réel possible chez Shopify). Seul un déploiement avec
  // NODE_ENV=production crée une charge réelle — jamais par défaut.
  return process.env.NODE_ENV !== "production";
}

async function billingGraphqlRequest<T>(creds: ShopifyCredentials, query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(`https://${creds.domain}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "content-type": "application/json", "X-Shopify-Access-Token": creds.accessToken },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new ShopifyApiError(`Shopify Billing API a répondu ${res.status}`, res.status);
  const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (json.errors?.length) throw new ShopifyApiError(json.errors.map((e) => e.message).join("; "));
  if (!json.data) throw new ShopifyApiError("Réponse Shopify Billing vide.");
  return json.data;
}

const SUBSCRIPTION_CREATE_MUTATION = `
  mutation appSubscriptionCreate(
    $name: String!, $returnUrl: URL!, $test: Boolean!, $lineItems: [AppSubscriptionLineItemInput!]!
  ) {
    appSubscriptionCreate(name: $name, returnUrl: $returnUrl, test: $test, lineItems: $lineItems) {
      appSubscription { id status }
      confirmationUrl
      userErrors { field message }
    }
  }
`;

export interface CreateSubscriptionResult {
  confirmationUrl: string;
  subscriptionId: string;
}

/**
 * Crée une demande d'abonnement Shopify Billing pour le plan choisi.
 * Retourne l'URL de confirmation Shopify — c'est le marchand qui approuve
 * la charge sur cette page, jamais l'app. Le passage réel au plan payant
 * n'intervient qu'à réception du webhook app_subscriptions/update avec le
 * statut ACTIVE (voir /api/webhooks/shopify/app-subscription-update).
 */
export async function createAppSubscription(
  creds: ShopifyCredentials,
  plan: PaidPlan,
  returnUrl: string,
): Promise<CreateSubscriptionResult> {
  const price = PLAN_PRICING[plan];
  const data = await billingGraphqlRequest<{
    appSubscriptionCreate: {
      appSubscription: { id: string; status: string } | null;
      confirmationUrl: string | null;
      userErrors: Array<{ field: string[] | null; message: string }>;
    };
  }>(creds, SUBSCRIPTION_CREATE_MUTATION, {
    name: `OnDeal Intelligence — Plan ${plan}`,
    returnUrl,
    test: isTestMode(),
    lineItems: [
      {
        plan: {
          appRecurringPricingDetails: {
            price: { amount: price, currencyCode: "EUR" },
            interval: "EVERY_30_DAYS",
          },
        },
      },
    ],
  });

  const result = data.appSubscriptionCreate;
  if (result.userErrors.length) {
    throw new ShopifyApiError(result.userErrors.map((e) => e.message).join("; "));
  }
  if (!result.confirmationUrl || !result.appSubscription) {
    throw new ShopifyApiError("Shopify n'a pas renvoyé d'URL de confirmation pour cet abonnement.");
  }
  return { confirmationUrl: result.confirmationUrl, subscriptionId: result.appSubscription.id };
}

/** Fait correspondre le nom d'abonnement Shopify à un plan OnDeal — jamais deviné, uniquement les libellés que createAppSubscription émet. */
export function planFromSubscriptionName(name: string): PaidPlan | null {
  for (const plan of Object.keys(PLAN_PRICING) as PaidPlan[]) {
    if (name.includes(`Plan ${plan}`)) return plan;
  }
  return null;
}
