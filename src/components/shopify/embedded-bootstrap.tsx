"use client";

import { useEffect, useState } from "react";

// COMMERCIALISATION — pont entre App Bridge (chargé globalement dans le
// layout racine) et la session OnDeal. Rendu UNIQUEMENT quand la page
// racine détecte un chargement embarqué (voir src/app/page.tsx). N'appelle
// jamais Shopify avec un mot de passe ou un jeton saisi : uniquement le
// jeton de session émis par App Bridge côté client.
declare global {
  interface Window {
    shopify?: { idToken: () => Promise<string> };
  }
}

async function waitForAppBridge(maxAttempts = 50): Promise<Window["shopify"]> {
  for (let i = 0; i < maxAttempts; i++) {
    if (window.shopify?.idToken) return window.shopify;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return undefined;
}

export function EmbeddedBootstrap() {
  const [status, setStatus] = useState<"loading" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      const params = new URLSearchParams(window.location.search);
      const shop = params.get("shop");

      const bridge = await waitForAppBridge();
      if (cancelled) return;

      if (!bridge) {
        setStatus("error");
        setErrorMessage("App Bridge indisponible — rechargez la page depuis votre admin Shopify.");
        return;
      }

      try {
        const idToken = await bridge.idToken();
        const res = await fetch("/api/shopify/session-token-exchange", {
          method: "POST",
          headers: { Authorization: `Bearer ${idToken}` },
        });

        if (res.ok) {
          const data = (await res.json()) as { redirectUrl: string };
          if (!cancelled) window.location.href = data.redirectUrl;
          return;
        }

        // Boutique pas encore autorisée (ou jeton refusé) : on sort de
        // l'iframe pour lancer le consentement OAuth classique — Shopify
        // interdit toute redirection top-level automatique DEPUIS l'intérieur
        // d'une iframe sans que ce soit explicitement window.top.
        if (shop) {
          window.top!.location.href = `/api/shopify/install?shop=${encodeURIComponent(shop)}`;
        } else {
          setStatus("error");
          setErrorMessage("Paramètre boutique manquant dans l'URL.");
        }
      } catch {
        if (!cancelled) {
          setStatus("error");
          setErrorMessage("Connexion à Shopify impossible pour le moment. Rechargez la page.");
        }
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        fontFamily: "system-ui, sans-serif",
        color: "#374151",
        fontSize: 14,
      }}
    >
      {status === "error" ? errorMessage : "Connexion à votre boutique Shopify…"}
    </div>
  );
}
