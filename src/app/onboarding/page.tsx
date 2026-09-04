"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const STEPS = ["Boutique", "Intégrations", "Coûts"];

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [storeName, setStoreName] = useState("");
  const [domain, setDomain] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [storeId, setStoreId] = useState<string | null>(null);
  const [shipping, setShipping] = useState("");
  const [fees, setFees] = useState("");

  async function createRealStore() {
    setLoading(true);
    setError(null);
    const res = await fetch("/api/onboarding", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "real", storeName, domain }),
    });
    setLoading(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Échec de création de la boutique.");
      return;
    }
    const data = await res.json();
    setStoreId(data.storeId);
    setStep(1);
  }

  async function tryDemo() {
    setLoading(true);
    setError(null);
    const res = await fetch("/api/onboarding", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "demo" }),
    });
    setLoading(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Échec.");
      return;
    }
    const data = await res.json();
    router.push(`/dashboard?store=${data.storeId}`);
  }

  // Étape 3 — hypothèses de coût boutique (transport, frais de paiement).
  // Sans elles, la marge complète reste INDISPONIBLE sur tout le catalogue
  // (voir Prix & Marge) : demandée ici pour que le client la voie dès le
  // départ, jamais bloquante (« Ignorer » reste toujours possible — la
  // bannière de Prix & Marge reprend le relais si le client passe par
  // l'installation Shopify en un clic, qui ne passe pas par cet écran).
  async function saveCostAssumptions() {
    if (!storeId) return;
    setLoading(true);
    setError(null);
    const res = await fetch("/api/stores/cost-defaults", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        storeId,
        defaultShippingCost: shipping.trim() === "" ? null : Number(shipping),
        defaultPaymentFeesRate: fees.trim() === "" ? null : Number(fees) / 100,
      }),
    });
    setLoading(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Échec de l'enregistrement.");
      return;
    }
    router.push(`/dashboard?store=${storeId}`);
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card" style={{ maxWidth: 480 }}>
        <div className="stepper">
          {STEPS.map((_, i) => (
            <div key={i} className={`step-dot ${i <= step ? "active" : ""}`} />
          ))}
        </div>

        {step === 0 && (
          <>
            <h1 style={{ fontSize: 20, fontWeight: 800, marginBottom: 6 }}>Bienvenue sur OnDeal Intelligence</h1>
            <p style={{ color: "#6b6b85", fontSize: 14, marginBottom: 20 }}>
              Connectez votre première boutique, ou essayez d'abord avec des données de démonstration clairement
              identifiées comme fictives.
            </p>
            {error && <div className="callout callout-error">{error}</div>}
            <div className="field">
              <label>Nom de la boutique</label>
              <input className="input" name="storeName" placeholder="ex. OnDeal.fr" value={storeName} onChange={(e) => setStoreName(e.target.value)} />
            </div>
            <div className="field">
              <label>Domaine Shopify (optionnel à ce stade)</label>
              <input className="input" name="domain" placeholder="ex. ondeal.myshopify.com" value={domain} onChange={(e) => setDomain(e.target.value)} />
            </div>
            <button className="btn btn-primary" style={{ width: "100%" }} disabled={loading || !storeName} onClick={createRealStore}>
              {loading ? "Création…" : "Créer ma boutique"}
            </button>
            <button className="btn btn-secondary" style={{ width: "100%", marginTop: 10 }} disabled={loading} onClick={tryDemo}>
              Essayer avec des données de démonstration
            </button>
          </>
        )}

        {step === 1 && storeId && (
          <>
            <h1 style={{ fontSize: 20, fontWeight: 800, marginBottom: 6 }}>Connectez vos intégrations</h1>
            <p style={{ color: "#6b6b85", fontSize: 14, marginBottom: 20 }}>
              Shopify (catalogue, stock, commandes) et Judge.me (avis) se connectent depuis les Paramètres.
              Vous pouvez aussi passer cette étape et les connecter plus tard.
            </p>
            <button
              className="btn btn-primary"
              style={{ width: "100%" }}
              onClick={() => router.push(`/settings/integrations?store=${storeId}`)}
            >
              Connecter Shopify / Judge.me maintenant
            </button>
            <button
              className="btn btn-secondary"
              style={{ width: "100%", marginTop: 10 }}
              onClick={() => setStep(2)}
            >
              Passer cette étape
            </button>
          </>
        )}

        {step === 2 && storeId && (
          <>
            <h1 style={{ fontSize: 20, fontWeight: 800, marginBottom: 6 }}>Hypothèses de coût</h1>
            <p style={{ color: "#6b6b85", fontSize: 14, marginBottom: 20 }}>
              Pour calculer votre marge complète, renseignez vos coûts moyens. Vous pourrez les affiner produit par
              produit plus tard, dans Prix &amp; Marge.
            </p>
            {error && <div className="callout callout-error">{error}</div>}
            <div className="field">
              <label>Transport moyen par unité vendue (€)</label>
              <input className="input" type="number" min="0" step="0.01" placeholder="non renseigné" value={shipping} onChange={(e) => setShipping(e.target.value)} />
            </div>
            <div className="field">
              <label>Frais de paiement (%)</label>
              <input className="input" type="number" min="0" max="100" step="0.01" placeholder="non renseigné" value={fees} onChange={(e) => setFees(e.target.value)} />
            </div>
            <button className="btn btn-primary" style={{ width: "100%" }} disabled={loading} onClick={saveCostAssumptions}>
              {loading ? "Enregistrement…" : "Enregistrer et continuer →"}
            </button>
            <button
              className="btn btn-secondary"
              style={{ width: "100%", marginTop: 10 }}
              disabled={loading}
              onClick={() => router.push(`/dashboard?store=${storeId}`)}
            >
              Ignorer pour l&apos;instant
            </button>
          </>
        )}
      </div>
    </div>
  );
}
