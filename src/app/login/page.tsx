"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

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
    <div className="auth-wrap">
      <div className="auth-card">
        <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>OnDeal Intelligence</h1>
        <p style={{ color: "#6b6b85", fontSize: 14, marginBottom: 24 }}>Connectez-vous à votre copilote e-commerce.</p>
        {error && <div className="callout callout-error">{error}</div>}
        <form onSubmit={onSubmit}>
          <div className="field">
            <label>Email</label>
            <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="field">
            <label>Mot de passe</label>
            <input className="input" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <button className="btn btn-primary" type="submit" disabled={loading} style={{ width: "100%", marginTop: 8 }}>
            {loading ? "Connexion…" : "Se connecter"}
          </button>
        </form>
        <p style={{ fontSize: 13.5, marginTop: 18, textAlign: "center", color: "#6b6b85" }}>
          Pas encore de compte ? <Link href="/signup" style={{ color: "#4f46e5", fontWeight: 700 }}>Créer un compte</Link>
        </p>
      </div>
    </div>
  );
}
