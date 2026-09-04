"use client";

import { useEffect, useState } from "react";

/**
 * Filet de sécurité : contrairement à l'étape d'onboarding (Boutique →
 * Intégrations → Coûts), cette bannière s'affiche à chaque visite de
 * Prix & Marge tant que les hypothèses boutique manquent — y compris pour
 * une boutique provisionnée via l'installation Shopify en un clic
 * (`attachShopifyToExistingStore` / `provisionStoreFromShopifyAuth`), qui ne
 * passe jamais par /onboarding. C'est donc elle, pas l'étape d'onboarding,
 * qui garantit qu'aucun client n'atteint cette page sans voir la demande.
 * Masquée pour la session en cours via sessionStorage (jamais localStorage :
 * elle doit réapparaître à la session suivante tant que non renseigné).
 */
export default function CostAssumptionsBanner({ storeId }: { storeId: string }) {
  const key = `ondeal:cost-assumptions-banner-dismissed:${storeId}`;
  const [dismissed, setDismissed] = useState(true); // évite un flash avant lecture de sessionStorage

  useEffect(() => {
    try {
      const wasDismissed = sessionStorage.getItem(key) === "1";
      // eslint-disable-next-line react-hooks/set-state-in-effect -- hydratation post-SSR à exécution unique, pas une synchronisation continue.
      setDismissed(wasDismissed);
    } catch {
      setDismissed(false);
    }
  }, [key]);

  if (dismissed) return null;

  function dismiss() {
    try {
      sessionStorage.setItem(key, "1");
    } catch {
      // stockage indisponible : la bannière reste simplement visible, sans casser la page.
    }
    setDismissed(true);
  }

  return (
    <div className="callout callout-warning" style={{ marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
      <span>
        <strong>Marge complète indisponible.</strong> Renseignez vos hypothèses de coût boutique ci-dessous pour débloquer le calcul de marge
        complète sur tout votre catalogue.
      </span>
      <span style={{ display: "flex", gap: 8, flexShrink: 0 }}>
        <a href="#store-cost-defaults" className="btn btn-sm btn-secondary" onClick={dismiss}>
          Configurer maintenant
        </a>
        <button type="button" className="btn btn-sm btn-secondary" onClick={dismiss} aria-label="Masquer pour cette session">
          ×
        </button>
      </span>
    </div>
  );
}
