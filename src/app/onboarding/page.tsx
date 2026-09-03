"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const STEPS = ["Boutique", "Intégrations", "Analyse"];

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [storeName, setStoreName] = useState("");
  const [domain, setDomain] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [storeId, setStoreId] = useState<string | null>(null);

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
              <input className="input" placeholder="ex. OnDeal.fr" value={storeName} onChange={(e) => setStoreName(e.target.value)} />
            </div>
            <div className="field">
              <label>Domaine Shopify (optionnel à ce stade)</label>
              <input className="input" placeholder="ex. ondeal.myshopify.com" value={domain} onChange={(e) => setDomain(e.target.value)} />
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
              onClick={() => router.push(`/dashboard?store=${storeId}`)}
            >
              Passer cette étape — voir le tableau de bord
            </button>
          </>
        )}
      </div>
    </div>
  );
}
