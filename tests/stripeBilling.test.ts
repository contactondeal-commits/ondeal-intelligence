import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import crypto from "crypto";
import {
  isStripeConfigured,
  planFromPriceId,
  createStripeCustomer,
  createCheckoutSession,
  verifyStripeWebhookSignature,
  StripeApiError,
} from "@/lib/integrations/stripe-billing";

const REAL_FETCH = global.fetch;
const ENV_KEYS = ["STRIPE_SECRET_KEY", "STRIPE_PRICE_PRO", "STRIPE_PRICE_BUSINESS", "STRIPE_PRICE_AGENCY", "STRIPE_WEBHOOK_SECRET"];

function clearEnv() {
  for (const k of ENV_KEYS) delete process.env[k];
}

function mockFetchOnce(status: number, body: unknown) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  clearEnv();
});

afterEach(() => {
  global.fetch = REAL_FETCH;
  clearEnv();
  vi.restoreAllMocks();
});

describe("isStripeConfigured — jamais un bouton actif sans configuration complète", () => {
  it("false si aucune variable d'environnement n'est définie", () => {
    expect(isStripeConfigured()).toBe(false);
  });

  it("false s'il manque un seul Price (ex. AGENCY absent)", () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    process.env.STRIPE_PRICE_PRO = "price_pro";
    process.env.STRIPE_PRICE_BUSINESS = "price_business";
    expect(isStripeConfigured()).toBe(false);
  });

  it("true si la clé secrète et les 3 Price sont configurés", () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    process.env.STRIPE_PRICE_PRO = "price_pro";
    process.env.STRIPE_PRICE_BUSINESS = "price_business";
    process.env.STRIPE_PRICE_AGENCY = "price_agency";
    expect(isStripeConfigured()).toBe(true);
  });
});

describe("planFromPriceId — jamais deviné depuis un montant, seulement les Price réellement configurés", () => {
  beforeEach(() => {
    process.env.STRIPE_PRICE_PRO = "price_pro";
    process.env.STRIPE_PRICE_BUSINESS = "price_business";
    process.env.STRIPE_PRICE_AGENCY = "price_agency";
  });

  it("retrouve le bon plan pour un Price configuré", () => {
    expect(planFromPriceId("price_business")).toBe("BUSINESS");
  });

  it("retourne null pour un Price inconnu — jamais un plan par défaut inventé", () => {
    expect(planFromPriceId("price_inconnu")).toBeNull();
  });
});

describe("createStripeCustomer / createCheckoutSession — appels HTTP bruts vers l'API Stripe", () => {
  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    process.env.STRIPE_PRICE_PRO = "price_pro";
    process.env.STRIPE_PRICE_BUSINESS = "price_business";
    process.env.STRIPE_PRICE_AGENCY = "price_agency";
  });

  it("createStripeCustomer renvoie l'id Customer créé", async () => {
    mockFetchOnce(200, { id: "cus_123" });
    const id = await createStripeCustomer({ organizationId: "org_1", email: "a@b.com", name: "Boutique Test" });
    expect(id).toBe("cus_123");
    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.stripe.com/v1/customers",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("createCheckoutSession renvoie l'URL Checkout pour le Price du plan demandé", async () => {
    mockFetchOnce(200, { id: "cs_123", url: "https://checkout.stripe.com/pay/cs_123" });
    const result = await createCheckoutSession({
      customerId: "cus_123",
      plan: "PRO",
      successUrl: "https://app.test/settings?billing=stripe_return",
      cancelUrl: "https://app.test/settings",
    });
    expect(result.checkoutUrl).toBe("https://checkout.stripe.com/pay/cs_123");
    expect(result.sessionId).toBe("cs_123");
  });

  it("createCheckoutSession échoue proprement si aucun Price n'est configuré pour ce plan (jamais un fallback silencieux)", async () => {
    delete process.env.STRIPE_PRICE_AGENCY;
    await expect(
      createCheckoutSession({ customerId: "cus_123", plan: "AGENCY", successUrl: "x", cancelUrl: "y" }),
    ).rejects.toThrow(StripeApiError);
  });

  it("createCheckoutSession propage une erreur Stripe explicite (carte refusée, etc.) plutôt que de masquer l'échec", async () => {
    mockFetchOnce(402, { error: { message: "Your card was declined." } });
    await expect(
      createCheckoutSession({ customerId: "cus_123", plan: "PRO", successUrl: "x", cancelUrl: "y" }),
    ).rejects.toThrow("Your card was declined.");
  });
});

describe("verifyStripeWebhookSignature — reproduit l'algorithme public Stripe, jamais permissif", () => {
  const secret = "whsec_test_secret";

  function sign(payload: string, timestamp: number): string {
    const signedPayload = `${timestamp}.${payload}`;
    return crypto.createHmac("sha256", secret).update(signedPayload, "utf8").digest("hex");
  }

  beforeEach(() => {
    process.env.STRIPE_WEBHOOK_SECRET = secret;
  });

  it("accepte une signature valide et récente", () => {
    const now = new Date();
    const ts = Math.floor(now.getTime() / 1000);
    const body = JSON.stringify({ type: "customer.subscription.updated" });
    const header = `t=${ts},v1=${sign(body, ts)}`;
    expect(verifyStripeWebhookSignature(body, header, now)).toBe(true);
  });

  it("rejette une signature invalide (corps altéré après signature)", () => {
    const now = new Date();
    const ts = Math.floor(now.getTime() / 1000);
    const signedBody = JSON.stringify({ type: "customer.subscription.updated" });
    const header = `t=${ts},v1=${sign(signedBody, ts)}`;
    const tamperedBody = JSON.stringify({ type: "customer.subscription.updated", plan: "AGENCY" });
    expect(verifyStripeWebhookSignature(tamperedBody, header, now)).toBe(false);
  });

  it("rejette un événement trop ancien (protection anti-rejeu, tolérance 300s dépassée)", () => {
    const now = new Date();
    const oldTs = Math.floor(now.getTime() / 1000) - 600;
    const body = JSON.stringify({ type: "customer.subscription.updated" });
    const header = `t=${oldTs},v1=${sign(body, oldTs)}`;
    expect(verifyStripeWebhookSignature(body, header, now)).toBe(false);
  });

  it("rejette si aucun header de signature n'est fourni", () => {
    expect(verifyStripeWebhookSignature("{}", null)).toBe(false);
  });

  it("rejette si STRIPE_WEBHOOK_SECRET n'est pas configuré", () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const now = new Date();
    const ts = Math.floor(now.getTime() / 1000);
    const body = "{}";
    const header = `t=${ts},v1=${crypto.createHmac("sha256", "wrong-secret").update(`${ts}.${body}`).digest("hex")}`;
    expect(verifyStripeWebhookSignature(body, header, now)).toBe(false);
  });

  it("accepte si l'UNE des signatures v1 multiples (rotation de secret) correspond", () => {
    const now = new Date();
    const ts = Math.floor(now.getTime() / 1000);
    const body = JSON.stringify({ type: "customer.subscription.updated" });
    const wrongSig = crypto.createHmac("sha256", "autre-secret").update(`${ts}.${body}`).digest("hex");
    const header = `t=${ts},v1=${wrongSig},v1=${sign(body, ts)}`;
    expect(verifyStripeWebhookSignature(body, header, now)).toBe(true);
  });
});
