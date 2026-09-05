"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function SignupPage() {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", email: "", password: "", organizationName: "" });
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Case CGU/confidentialité obligatoire (audit conformité 05/09/2026) —
    // validée aussi côté serveur, ce contrôle client n'est qu'un confort.
    if (!acceptedTerms) {
      setError("Vous devez accepter les CGU et la politique de confidentialité pour créer un compte.");
      return;
    }
    setLoading(true);
    setError(null);
    const res = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...form, acceptedTerms }),
    });
    setLoading(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Échec de création du compte.");
      return;
    }
    router.push("/onboarding");
    router.refresh();
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>Créer votre compte</h1>
        <p style={{ color: "#6b6b85", fontSize: 14, marginBottom: 24 }}>OnDeal Intelligence — copilote e-commerce multi-boutiques.</p>
        {error && <div className="callout callout-error">{error}</div>}
        <form onSubmit={onSubmit}>
          <div className="field">
            <label>Nom</label>
            <input className="input" name="name" autoComplete="name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="field">
            <label>Nom de votre organisation</label>
            <input
              className="input"
              name="organizationName"
              autoComplete="organization"
              required
              placeholder="ex. OnDeal"
              value={form.organizationName}
              onChange={(e) => setForm({ ...form, organizationName: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Email</label>
            <input className="input" name="email" type="email" autoComplete="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div className="field">
            <label>Mot de passe (8 caractères min.)</label>
            <input
              className="input"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              maxLength={128}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </div>
          <div className="field" style={{ display: "flex", alignItems: "flex-start", gap: 8, marginTop: 4 }}>
            <input
              id="acceptedTerms"
              type="checkbox"
              required
              checked={acceptedTerms}
              onChange={(e) => setAcceptedTerms(e.target.checked)}
              style={{ marginTop: 3 }}
            />
            <label htmlFor="acceptedTerms" style={{ fontSize: 13, color: "#6b6b85", fontWeight: 400 }}>
              J&apos;accepte les{" "}
              <Link href="/cgu" target="_blank" style={{ color: "#4f46e5", fontWeight: 700 }}>
                CGU
              </Link>{" "}
              et la{" "}
              <Link href="/privacy" target="_blank" style={{ color: "#4f46e5", fontWeight: 700 }}>
                politique de confidentialité
              </Link>{" "}
              d&apos;OnDeal Intelligence.
            </label>
          </div>
          <button className="btn btn-primary" type="submit" disabled={loading || !acceptedTerms} style={{ width: "100%", marginTop: 12 }}>
            {loading ? "Création…" : "Créer mon compte"}
          </button>
        </form>
        <p style={{ fontSize: 13.5, marginTop: 18, textAlign: "center", color: "#6b6b85" }}>
          Déjà un compte ? <Link href="/login" style={{ color: "#4f46e5", fontWeight: 700 }}>Se connecter</Link>
        </p>
        <p style={{ fontSize: 12, marginTop: 14, textAlign: "center", color: "#6b6b85" }}>
          <Link href="/mentions-legales" style={{ color: "inherit" }}>Mentions légales</Link>
          {" · "}
          <Link href="/privacy" style={{ color: "inherit" }}>Confidentialité</Link>
          {" · "}
          <Link href="/cgu" style={{ color: "inherit" }}>CGU</Link>
        </p>
      </div>
    </div>
  );
}
