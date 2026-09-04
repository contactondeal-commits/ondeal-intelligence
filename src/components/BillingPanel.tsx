"use client";

import { useState } from "react";
import { CreditCard } from "lucide-react";
import Button from "@/components/ui/Button";
import { PLAN_PRICING, type PaidPlan } from "@/lib/integrations/shopify-billing";

const PLAN_ORDER: PaidPlan[] = ["PRO", "BUSINESS", "AGENCY"];

/**
 * COMMERCIALISATION — bouton "Passer au plan X" (Paramètres > Organisation).
 * N'active JAMAIS un plan directement : appelle POST /api/billing/subscribe
 * puis redirige vers la page de confirmation Shopify elle-même — c'est le
 * marchand qui approuve la charge chez Shopify, jamais cette app. Le plan
 * n'est réellement activé qu'à réception du webhook app_subscriptions/update
 * (voir /api/webhooks/shopify/app-subscription-update), jamais anticipé ici.
 */
export default function BillingPanel({
  storeId,
  currentPlan,
  shopifyConnected,
  subscriptionStatus,
  billingReturn,
}: {
  storeId: string;
  currentPlan: "STARTER" | PaidPlan;
  shopifyConnected: boolean;
  subscriptionStatus: string | null;
  billingReturn: boolean;
}) {
  const [loadingPlan, setLoadingPlan] = useState<PaidPlan | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function upgrade(plan: PaidPlan) {
    setError(null);
    setLoadingPlan(plan);
    try {
      const res = await fetch("/api/billing/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ storeId, plan }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.confirmationUrl) {
        setError(data.error ?? "Impossible de créer la demande d'abonnement.");
        setLoadingPlan(null);
        return;
      }
      // Redirection vers la page de confirmation Shopify (hors app) —
      // c'est Shopify qui affiche le prix et recueille l'accord du marchand.
      window.location.href = data.confirmationUrl;
    } catch {
      setError("Impossible de contacter le serveur. Réessayez.");
      setLoadingPlan(null);
    }
  }

  return (
    <div className="billing-panel">
      {billingReturn && (
        <p className="cell-sub" style={{ marginBottom: 8 }}>
          Retour de Shopify. La confirmation de votre abonnement peut prendre quelques instants
          (elle passe par un webhook Shopify) — rafraîchissez la page si le plan ne s&apos;est pas
          encore mis à jour.
        </p>
      )}

      {!shopifyConnected ? (
        <p className="cell-sub">Connectez d&apos;abord Shopify (Paramètres &gt; Intégrations) pour changer de plan.</p>
      ) : (
        <>
          {subscriptionStatus === "PENDING" && (
            <p className="cell-sub" style={{ marginBottom: 8 }}>
              Une demande d&apos;abonnement est en attente d&apos;approbation côté Shopify.
            </p>
          )}
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
                    <Button
                      variant="primary"
                      size="sm"
                      icon={<CreditCard size={14} />}
                      loading={loadingPlan === plan}
                      disabled={loadingPlan !== null}
                      onClick={() => upgrade(plan)}
                    >
                      Passer au plan {plan}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
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
