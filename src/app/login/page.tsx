"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Package, Star, TrendingUp, Sparkles, ShieldCheck, Plug } from "lucide-react";
import LogoMark from "@/components/Logo";

const FEATURES = [
  {
    icon: Package,
    title: "Stock Intelligence",
    text: "Anticipez les ruptures avant qu'elles ne bloquent vos ventes. Chaque alerte est groupée par produit, triée par impact réel.",
  },
  {
    icon: Star,
    title: "Review Intelligence",
    text: "Transformez vos avis Judge.me en décisions produit concrètes, sans devoir tous les lire un par un.",
  },
  {
    icon: TrendingUp,
    title: "Prix & Marge",
    text: "Repérez en temps réel les produits qui vous font perdre de l'argent et agissez en un clic.",
  },
  {
    icon: Sparkles,
    title: "OnDeal AI",
    text: "Posez une question sur votre boutique, obtenez une réponse fondée sur vos vraies données — pas des estimations.",
  },
  {
    icon: ShieldCheck,
    title: "Vous gardez toujours le contrôle",
    text: "Aucune modification n'est jamais appliquée sur votre boutique sans votre validation explicite.",
  },
];

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    setLoading(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Échec de connexion.");
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <div className="auth-wrap auth-wrap-split">
      <div className="auth-shell">
        <section className="auth-marketing" aria-label="À propos d'OnDeal Intelligence">
          <div className="auth-marketing-brand">
            <span className="brand-mark" aria-hidden="true">
              <LogoMark size={18} />
            </span>
            <p className="auth-marketing-kicker">OnDeal Intelligence</p>
          </div>
          <h1 className="auth-marketing-title">
            Détectez les problèmes de votre boutique
            <br />
            <span className="auth-marketing-title-accent">avant qu&apos;ils vous coûtent de l&apos;argent.</span>
          </h1>
          <p className="auth-marketing-lead">
            Votre boutique génère des milliers de signaux chaque jour.
            <br />
            OnDeal Intelligence les transforme en décisions prioritaires claires —
            <br />
            et vous dit exactement quoi faire, sans jamais agir sans votre confirmation.
          </p>
          <p className="auth-compat">
            <Plug size={13} aria-hidden="true" />
            Compatible avec <strong>Shopify</strong>, <strong>WooCommerce</strong> et <strong>PrestaShop</strong>
          </p>
          <ul className="auth-feature-list">
            {FEATURES.map((f) => (
              <li key={f.title} className="auth-feature-item">
                <span className="auth-feature-icon">
                  <f.icon size={16} aria-hidden="true" />
                </span>
                <span>
                  <strong>{f.title}</strong>
                  <span className="auth-feature-text">{f.text}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="auth-social-proof">
            Déjà en production · +1&nbsp;700 produits analysés · Données Shopify en temps réel
          </p>
          <div className="auth-plan-teaser">
            <span className="badge badge-suggestion" style={{ flexShrink: 0, whiteSpace: "nowrap" }}>Starter gratuit</span>
            <span className="auth-plan-teaser-text">Sans carte bancaire pour démarrer. Une version payante existe pour qui en ressent le besoin — jamais imposée.</span>
          </div>
        </section>

        <div className="auth-card">
          <h2 style={{ fontSize: 20, fontWeight: 800, marginBottom: 4 }}>Connexion</h2>
          <p style={{ color: "var(--color-text-muted)", fontSize: 14, marginBottom: 24 }}>Accédez à votre copilote e-commerce.</p>
          {error && <div className="callout callout-error">{error}</div>}
          <form onSubmit={onSubmit}>
            <div className="field">
              <label>Email</label>
              <input className="input" name="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="field">
              <label>Mot de passe</label>
              <input className="input" name="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <button className="btn btn-primary" type="submit" disabled={loading} style={{ width: "100%", marginTop: 8 }}>
              {loading ? "Connexion…" : "Accéder à mon tableau de bord →"}
            </button>
          </form>
          <p style={{ fontSize: 13.5, marginTop: 18, textAlign: "center", color: "var(--color-text-muted)" }}>
            Pas encore de compte ? <Link href="/signup" style={{ color: "var(--color-primary-dark)", fontWeight: 700 }}>Demander un accès</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
