import crypto from "crypto";

/**
 * FACTURATION STRIPE (lot 11, 05/09/2026) — chemin de paiement indépendant
 * de Shopify. Contrainte connue et documentée (voir shopify-billing.ts) :
 * les règles du Shopify App Store imposent leur propre API Billing pour un
 * abonnement récurrent lié à l'usage de l'app DANS l'écosystème Shopify —
 * Stripe reste donc une option supplémentaire à ne jamais présenter comme
 * remplaçant la facturation Shopify pour un marchand qui soumettrait
 * l'app à l'App Store à l'avenir. Décision explicite de l'exploitant du
 * produit (05/09/2026) : l'ouvrir dès maintenant à TOUT le monde
 * (marchand Shopify inclus) pour ne dépendre d'aucune revue de plateforme
 * — risque de conformité assumé consciemment, documenté ici pour mémoire.
 *
 * Implémentation en appels HTTP bruts (comme shopify-billing.ts), pas via
 * le SDK Node `stripe` : aucune nouvelle dépendance, même style que le
 * reste du code, et vérification de signature reproduisant exactement
 * l'algorithme public documenté par Stripe (HMAC-SHA256 sur
 * "timestamp.corps", comparaison en temps constant, tolérance de rejeu).
 *
 * AUCUNE charge n'est jamais créée directement par ce module : il ne fait
 * que créer une session Stripe Checkout, hébergée et confirmée par Stripe
 * lui-même (mêmes garanties PCI que n'importe quel commerçant utilisant
 * Stripe). Le plan n'est réellement activé qu'à réception du webhook
 * confirmant un abonnement au statut actif (voir /api/webhooks/stripe).
 */

const STRIPE_API_BASE = "https://api.stripe.com/v1";

export type PaidPlan = "PRO" | "BUSINESS" | "AGENCY";

// Mêmes tarifs que la facturation Shopify (shopify-billing.ts) — affichage
// uniquement : le montant réellement facturé provient du Price Stripe
// configuré côté Dashboard Stripe (source de vérité pour la charge elle-même,
// jamais recalculé ici).
export const PLAN_PRICING: Record<PaidPlan, number> = {
  PRO: 14.9,
  BUSINESS: 49.9,
  AGENCY: 99,
};

const PLAN_PRICE_ENV: Record<PaidPlan, string> = {
  PRO: "STRIPE_PRICE_PRO",
  BUSINESS: "STRIPE_PRICE_BUSINESS",
  AGENCY: "STRIPE_PRICE_AGENCY",
};

export class StripeApiError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = "StripeApiError";
  }
}

function getSecretKey(): string | null {
  const key = process.env.STRIPE_SECRET_KEY;
  return key && key.trim().length > 0 ? key : null;
}

function priceIdForPlan(plan: PaidPlan): string | null {
  const id = process.env[PLAN_PRICE_ENV[plan]];
  return id && id.trim().length > 0 ? id : null;
}

/**
 * true seulement si TOUT ce qui est nécessaire pour accepter ET ACTIVER un
 * paiement Stripe est configuré (clé secrète + un Price par plan payant +
 * le secret de signature webhook). CORRECTIF (audit conformité 05/09/2026) :
 * sans STRIPE_WEBHOOK_SECRET, un marchand peut réellement payer chez Stripe
 * (Checkout fonctionne avec la seule clé secrète) mais le webhook qui active
 * le plan est systématiquement rejeté (signature invalide) — paiement
 * encaissé, plan jamais activé, silencieusement. Inclure ce secret ici
 * garantit qu'un bouton "Par carte" n'est jamais affiché comme opérationnel
 * si ce cas de figure est possible.
 */
export function isStripeConfigured(): boolean {
  if (!getSecretKey()) return false;
  if (!process.env.STRIPE_WEBHOOK_SECRET) return false;
  return (Object.keys(PLAN_PRICING) as PaidPlan[]).every((p) => priceIdForPlan(p) !== null);
}

/** Fait correspondre un Price Stripe (id réellement configuré) à un plan OnDeal — jamais deviné depuis un montant. */
export function planFromPriceId(priceId: string): PaidPlan | null {
  for (const plan of Object.keys(PLAN_PRICING) as PaidPlan[]) {
    if (priceIdForPlan(plan) === priceId) return plan;
  }
  return null;
}

function requireSecretKey(): string {
  const key = getSecretKey();
  if (!key) throw new StripeApiError("STRIPE_SECRET_KEY non configurée.");
  return key;
}

async function stripeRequest<T>(path: string, params: Record<string, string>): Promise<T> {
  const res = await fetch(`${STRIPE_API_BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requireSecretKey()}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params).toString(),
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok) {
    throw new StripeApiError(json?.error?.message ?? `Stripe API a répondu ${res.status}`, res.status);
  }
  return json;
}

/**
 * Crée (ou réutilise) le Customer Stripe d'une organisation. L'id est
 * persisté sur `Organization.stripeCustomerId` par l'appelant — jamais
 * recréé à chaque paiement (éviterait de fragmenter l'historique de
 * facturation Stripe du marchand).
 */
export async function createStripeCustomer(params: { organizationId: string; email: string; name: string }): Promise<string> {
  const data = await stripeRequest<{ id: string }>("/customers", {
    email: params.email,
    name: params.name,
    "metadata[organizationId]": params.organizationId,
  });
  return data.id;
}

export interface CreateCheckoutSessionResult {
  checkoutUrl: string;
  sessionId: string;
}

/**
 * Crée une session Stripe Checkout (hébergée par Stripe — page de
 * paiement, formulaire de carte, 3-D Secure éventuel : jamais géré par
 * cette app, jamais un numéro de carte qui transite par ce serveur).
 */
export async function createCheckoutSession(params: {
  customerId: string;
  plan: PaidPlan;
  successUrl: string;
  cancelUrl: string;
}): Promise<CreateCheckoutSessionResult> {
  const priceId = priceIdForPlan(params.plan);
  if (!priceId) throw new StripeApiError(`Aucun Price Stripe configuré pour le plan ${params.plan}.`);

  const data = await stripeRequest<{ id: string; url: string | null }>("/checkout/sessions", {
    mode: "subscription",
    customer: params.customerId,
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": "1",
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
  });
  if (!data.url) throw new StripeApiError("Stripe n'a pas renvoyé d'URL de session Checkout.");
  return { checkoutUrl: data.url, sessionId: data.id };
}

const WEBHOOK_TOLERANCE_SECONDS = 300; // identique à la tolérance par défaut du SDK officiel Stripe

/**
 * Vérifie la signature d'un webhook Stripe — reproduit l'algorithme public
 * documenté par Stripe (payload signé = "timestamp.corps brut", HMAC-SHA256
 * avec le secret de signature du endpoint, comparaison en temps constant).
 * Rejette aussi un événement trop ancien (protection anti-rejeu, même
 * tolérance que le SDK officiel). Retourne `false` sur toute anomalie —
 * jamais d'exception qui ferait planter la route au lieu de répondre 401.
 */
export function verifyStripeWebhookSignature(rawBody: string, signatureHeader: string | null, now: Date = new Date()): boolean {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!signatureHeader || !secret) return false;

  const parts = signatureHeader.split(",").reduce<Record<string, string[]>>((acc, part) => {
    const [key, value] = part.split("=");
    if (!key || !value) return acc;
    (acc[key] ??= []).push(value);
    return acc;
  }, {});

  const timestamp = parts["t"]?.[0];
  const candidates = parts["v1"] ?? [];
  if (!timestamp || candidates.length === 0) return false;

  const timestampMs = Number(timestamp) * 1000;
  if (!Number.isFinite(timestampMs) || Math.abs(now.getTime() - timestampMs) > WEBHOOK_TOLERANCE_SECONDS * 1000) {
    return false;
  }

  const signedPayload = `${timestamp}.${rawBody}`;
  const expected = crypto.createHmac("sha256", secret).update(signedPayload, "utf8").digest("hex");
  const expectedBuf = Buffer.from(expected);

  return candidates.some((candidate) => {
    try {
      const candidateBuf = Buffer.from(candidate);
      return candidateBuf.length === expectedBuf.length && crypto.timingSafeEqual(candidateBuf, expectedBuf);
    } catch {
      return false;
    }
  });
}

// Statuts Stripe pour lesquels un plan payant reste accordé — tout autre
// statut (past_due, canceled, unpaid, incomplete_expired, ...) repasse
// l'organisation en STARTER, même discipline stricte que la facturation
// Shopify : jamais un plan payant maintenu sans abonnement confirmé actif.
export const STRIPE_ACTIVE_STATUSES = new Set(["active", "trialing"]);
