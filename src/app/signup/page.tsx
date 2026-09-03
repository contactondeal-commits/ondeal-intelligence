"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function SignupPage() {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", email: "", password: "", organizationName: "" });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(form),
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
            <input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="field">
            <label>Nom de votre organisation</label>
            <input
              className="input"
              required
              placeholder="ex. OnDeal"
              value={form.organizationName}
              onChange={(e) => setForm({ ...form, organizationName: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Email</label>
            <input className="input" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div className="field">
            <label>Mot de passe (8 caractères min.)</label>
            <input
              className="input"
              type="password"
              required
              minLength={8}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </div>
          <button className="btn btn-primary" type="submit" disabled={loading} style={{ width: "100%", marginTop: 8 }}>
            {loading ? "Création…" : "Créer mon compte"}
          </button>
        </form>
        <p style={{ fontSize: 13.5, marginTop: 18, textAlign: "center", color: "#6b6b85" }}>
          Déjà un compte ? <Link href="/login" style={{ color: "#4f46e5", fontWeight: 700 }}>Se connecter</Link>
        </p>
      </div>
    </div>
  );
}
