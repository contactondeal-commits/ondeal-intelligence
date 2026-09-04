"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Package, Star, TrendingUp, Sparkles, ShieldCheck } from "lucide-react";

const FEATURES = [
  {
    icon: Package,
    title: "Stock Intelligence",
    text: "Anticipez les ruptures avant qu'elles ne coûtent des ventes, sur toute votre boutique Shopify.",
  },
  {
    icon: Star,
    title: "Review Intelligence",
    text: "Transformez vos avis Judge.me en décisions produit, sans devoir tous les lire un par un.",
  },
  {
    icon: TrendingUp,
    title: "Prix & marge",
    text: "Protégez votre marge réelle et repérez les opportunités de prix, produit par produit.",
  },
  {
    icon: Sparkles,
    title: "OnDeal AI",
    text: "Gagnez du temps : une question en langage naturel, une réponse fondée sur vos vraies données.",
  },
  {
    icon: ShieldCheck,
    title: "Vous gardez le contrôle",
    text: "Aucune action n'est jamais exécutée sur votre boutique sans votre validation explicite.",
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
          <p className="auth-marketing-kicker">OnDeal Intelligence</p>
          <h1 className="auth-marketing-title">Le copilote qui repère les problèmes de votre boutique avant vous</h1>
          <p className="auth-marketing-lead">
            Stock, avis, prix et marge : OnDeal Intelligence transforme les données réelles de votre boutique Shopify
            en signaux clairs et en décisions — jamais en actions automatiques non confirmées.
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
          <div className="auth-plan-teaser">
            <span className="badge badge-suggestion">Starter gratuit</span>
            <span className="auth-plan-teaser-text">Sans carte bancaire pour démarrer — évoluez vers PRO (14,90&nbsp;€/mois) quand vous en avez besoin.</span>
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
              {loading ? "Connexion…" : "Se connecter"}
            </button>
          </form>
          <p style={{ fontSize: 13.5, marginTop: 18, textAlign: "center", color: "var(--color-text-muted)" }}>
            Pas encore de compte ? <Link href="/signup" style={{ color: "var(--color-primary-dark)", fontWeight: 700 }}>Créer un compte</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
