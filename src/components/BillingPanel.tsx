"use client";

import { useState } from "react";
import { CreditCard, ShoppingBag } from "lucide-react";
import Button from "@/components/ui/Button";
import { PLAN_PRICING, type PaidPlan } from "@/lib/integrations/shopify-billing";

const PLAN_ORDER: PaidPlan[] = ["PRO", "BUSINESS", "AGENCY"];

/**
 * COMMERCIALISATION — deux chemins de paiement indépendants, jamais
 * mélangés :
 * - Shopify Billing (bouton "via Shopify") : n'active jamais un plan
 *   directement, redirige vers la page de confirmation Shopify elle-même
 *   — c'est le marchand qui approuve la charge chez Shopify, jamais cette
 *   app. Réservé aux boutiques Shopify connectées (règle de la plateforme).
 * - Stripe Checkout (bouton "par carte") : lot 11 (05/09/2026), ouvert à
 *   TOUTE organisation, quelle que soit sa plateforme catalogue — le
 *   paiement par carte est traité entièrement par la page hébergée par
 *   Stripe (jamais un numéro de carte saisi dans cette app).
 * Dans les deux cas, le plan n'est réellement activé qu'à réception du
 * webhook correspondant confirmant un abonnement actif — jamais anticipé
 * ici au moment du clic.
 */
export default function BillingPanel({
  storeId,
  currentPlan,
  shopifyConnected,
  shopifySubscriptionStatus,
  stripeConfigured,
  billingProvider,
  stripeSubscriptionStatus,
  billingReturn,
}: {
  storeId: string;
  currentPlan: "STARTER" | PaidPlan;
  shopifyConnected: boolean;
  shopifySubscriptionStatus: string | null;
  stripeConfigured: boolean;
  billingProvider: string | null;
  stripeSubscriptionStatus: string | null;
  billingReturn: "shopify" | "stripe" | null;
}) {
  const [loadingPlan, setLoadingPlan] = useState<PaidPlan | null>(null);
  const [loadingMethod, setLoadingMethod] = useState<"shopify" | "stripe" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function upgrade(plan: PaidPlan, method: "shopify" | "stripe") {
    setError(null);
    setLoadingPlan(plan);
    setLoadingMethod(method);
    try {
      const res = await fetch(method === "shopify" ? "/api/billing/subscribe" : "/api/billing/stripe/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ storeId, plan }),
      });
      const data = await res.json().catch(() => ({}));
      const redirectUrl = data.confirmationUrl ?? data.checkoutUrl;
      if (!res.ok || !redirectUrl) {
        setError(data.error ?? "Impossible de créer la demande d'abonnement.");
        setLoadingPlan(null);
        setLoadingMethod(null);
        return;
      }
      // Redirection hors app (Shopify ou Stripe) — c'est la plateforme de
      // paiement qui affiche le prix et recueille l'accord du marchand.
      window.location.href = redirectUrl;
    } catch {
      setError("Impossible de contacter le serveur. Réessayez.");
      setLoadingPlan(null);
      setLoadingMethod(null);
    }
  }

  const busy = loadingPlan !== null;

  return (
    <div className="billing-panel">
      {billingReturn === "shopify" && (
        <p className="cell-sub" style={{ marginBottom: 8 }}>
          Retour de Shopify. La confirmation de votre abonnement peut prendre quelques instants
          (elle passe par un webhook Shopify) — rafraîchissez la page si le plan ne s&apos;est pas
          encore mis à jour.
        </p>
      )}
      {billingReturn === "stripe" && (
        <p className="cell-sub" style={{ marginBottom: 8 }}>
          Retour de Stripe. La confirmation de votre abonnement peut prendre quelques instants
          (elle passe par un webhook Stripe) — rafraîchissez la page si le plan ne s&apos;est pas
          encore mis à jour.
        </p>
      )}
      {billingProvider === "shopify" && shopifySubscriptionStatus === "PENDING" && (
        <p className="cell-sub" style={{ marginBottom: 8 }}>
          Une demande d&apos;abonnement Shopify est en attente d&apos;approbation.
        </p>
      )}
      {billingProvider === "stripe" && stripeSubscriptionStatus && stripeSubscriptionStatus !== "active" && stripeSubscriptionStatus !== "trialing" && (
        <p className="cell-sub" style={{ marginBottom: 8, color: "var(--color-danger)" }}>
          Abonnement Stripe au statut « {stripeSubscriptionStatus} » — le plan payant peut ne plus être actif.
        </p>
      )}

      {!shopifyConnected && !stripeConfigured ? (
        <p className="cell-sub">
          Connectez Shopify (Paramètres &gt; Intégrations) pour changer de plan, ou revenez plus tard pour le paiement par carte.
        </p>
      ) : (
        <>
          <div className="billing-plan-grid">
            {PLAN_ORDER.map((plan) => {
              const isCurrent = plan === currentPlan;
              return (
                <div key={plan} className={`billing-plan-option${isCurrent ? " is-current" : ""}`}>
                  <div>
                    <strong>{plan}</strong>
                    <span className="cell-sub"> — {PLAN_PRICING[plan].toLocaleString("fr-FR", { minimumFractionDigits: 2 })} €/mois</span>
                  </div>
                  {isCurrent ? (
                    <span className="badge badge-suggestion">Plan actuel</span>
                  ) : (
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {shopifyConnected && (
                        <Button
                          variant="secondary"
                          size="sm"
                          icon={<ShoppingBag size={14} />}
                          loading={loadingPlan === plan && loadingMethod === "shopify"}
                          disabled={busy}
                          onClick={() => upgrade(plan, "shopify")}
                        >
                          Via Shopify
                        </Button>
                      )}
                      {stripeConfigured && (
                        <Button
                          variant="primary"
                          size="sm"
                          icon={<CreditCard size={14} />}
                          loading={loadingPlan === plan && loadingMethod === "stripe"}
                          disabled={busy}
                          onClick={() => upgrade(plan, "stripe")}
                        >
                          Par carte
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {!stripeConfigured && (
            <p className="cell-sub" style={{ marginTop: 8 }}>
              Le paiement par carte bancaire n&apos;est pas encore configuré — seule la facturation via Shopify est disponible pour le moment.
            </p>
          )}
          {error && (
            <p className="cell-sub" style={{ color: "var(--color-danger)", marginTop: 8 }}>
              {error}
            </p>
          )}
        </>
      )}
    </div>
  );
}
