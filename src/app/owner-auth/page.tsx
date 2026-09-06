"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { startRegistration, startAuthentication } from "@simplewebauthn/browser";

/**
 * ONDEAL AI CORE — OWNER STRONG AUTHENTICATION, page de cérémonie
 * WebAuthn/FIDO2 réelle (06/09/2026). Page volontairement SÉPARÉE de
 * /login : atteindre cette page suppose déjà une session applicative
 * normale valide ET l'appartenance à PLATFORM_OWNER_USER_IDS (sinon les
 * routes API /api/owner/webauthn/* renvoient 401/403) — c'est la SECONDE
 * porte, jamais une alternative à la première.
 */

type Mode = "CHECKING" | "NEEDS_REGISTRATION" | "NEEDS_LOGIN" | "RECOVERY" | "DONE";

export default function OwnerAuthPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("CHECKING");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deviceLabel, setDeviceLabel] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [recoveryForm, setRecoveryForm] = useState({ email: "", password: "", code: "" });

  const checkState = useCallback(async () => {
    // Aucune route dédiée "ai-je déjà une clé" — on tente directement une
    // option d'authentification ; une erreur explicite ("aucune clé
    // enregistrée") signifie qu'il faut s'enregistrer d'abord.
    const res = await fetch("/api/owner/webauthn/login/options", { method: "POST" });
    if (res.ok) {
      setMode("NEEDS_LOGIN");
    } else {
      setMode("NEEDS_REGISTRATION");
    }
  }, []);

  useEffect(() => {
    checkState();
  }, [checkState]);

  async function onRegister() {
    setBusy(true);
    setError(null);
    try {
      const optRes = await fetch("/api/owner/webauthn/register/options", { method: "POST" });
      if (!optRes.ok) throw new Error((await optRes.json()).error ?? "Impossible d'obtenir les options d'enregistrement.");
      const options = await optRes.json();
      const attestation = await startRegistration({ optionsJSON: options });
      const verifyRes = await fetch("/api/owner/webauthn/register/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deviceLabel: deviceLabel || "Clé sans nom", response: attestation }),
      });
      if (!verifyRes.ok) throw new Error((await verifyRes.json()).error ?? "Vérification d'enregistrement échouée.");
      const data = await verifyRes.json();
      if (data.recoveryCodes) {
        setRecoveryCodes(data.recoveryCodes);
      } else {
        setMode("DONE");
        router.push("/ai-lab");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de l'enregistrement de la clé.");
    } finally {
      setBusy(false);
    }
  }

  async function onLogin() {
    setBusy(true);
    setError(null);
    try {
      const optRes = await fetch("/api/owner/webauthn/login/options", { method: "POST" });
      if (!optRes.ok) throw new Error((await optRes.json()).error ?? "Impossible d'obtenir les options de connexion.");
      const options = await optRes.json();
      const assertion = await startAuthentication({ optionsJSON: options });
      const verifyRes = await fetch("/api/owner/webauthn/login/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ response: assertion }),
      });
      if (!verifyRes.ok) throw new Error((await verifyRes.json()).error ?? "Connexion par passkey échouée.");
      router.push("/ai-lab");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de la connexion par passkey.");
    } finally {
      setBusy(false);
    }
  }

  async function onRecovery(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/owner/recovery/consume", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(recoveryForm),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Code de récupération invalide.");
      setMode("NEEDS_REGISTRATION");
      setError(`Connexion de secours réussie (${(await res.json().catch(() => ({}))).recoveryCodesRemaining ?? "?"} codes restants). Enregistrez immédiatement une nouvelle clé WebAuthn ci-dessous.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de la récupération.");
    } finally {
      setBusy(false);
    }
  }

  if (recoveryCodes) {
    return (
      <div style={{ maxWidth: 560, margin: "60px auto", padding: 24, fontFamily: "system-ui" }}>
        <h1>Codes de récupération — à conserver maintenant</h1>
        <p>Ces 10 codes ne seront plus jamais affichés. Conservez-les en lieu sûr (gestionnaire de mots de passe, coffre-fort). Chacun ne fonctionne qu'une seule fois.</p>
        <pre style={{ background: "#111", color: "#eee", padding: 16, borderRadius: 8, fontSize: 16, lineHeight: 1.8 }}>{recoveryCodes.join("\n")}</pre>
        <button onClick={() => router.push("/ai-lab")} style={{ marginTop: 16, padding: "10px 20px" }}>
          J'ai enregistré ces codes — continuer vers AI Lab
        </button>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 560, margin: "60px auto", padding: 24, fontFamily: "system-ui" }}>
      <h1>Authentification renforcée — Platform Owner</h1>
      <p>AI Lab exige une clé WebAuthn/FIDO2 réelle (Touch ID, Face ID, Windows Hello, clé de sécurité physique) en plus de votre connexion habituelle.</p>
      {error && <p style={{ color: "#c00" }}>{error}</p>}

      {mode === "CHECKING" && <p>Vérification…</p>}

      {mode === "NEEDS_REGISTRATION" && (
        <div>
          <p>Aucune clé enregistrée pour ce compte. Enregistrez-en une maintenant.</p>
          <input
            placeholder="Nom de l'appareil (ex. MacBook — Touch ID)"
            value={deviceLabel}
            onChange={(e) => setDeviceLabel(e.target.value)}
            style={{ display: "block", width: "100%", padding: 8, marginBottom: 12 }}
          />
          <button disabled={busy} onClick={onRegister} style={{ padding: "10px 20px" }}>
            {busy ? "Enregistrement…" : "Enregistrer ma passkey"}
          </button>
          <p style={{ marginTop: 24 }}>
            <a href="#" onClick={(e) => { e.preventDefault(); setMode("RECOVERY"); }}>
              J'ai un code de récupération
            </a>
          </p>
        </div>
      )}

      {mode === "NEEDS_LOGIN" && (
        <div>
          <button disabled={busy} onClick={onLogin} style={{ padding: "10px 20px" }}>
            {busy ? "Connexion…" : "Se connecter avec ma passkey"}
          </button>
          <p style={{ marginTop: 24 }}>
            <a href="#" onClick={(e) => { e.preventDefault(); setMode("RECOVERY"); }}>
              Clé perdue — utiliser un code de récupération
            </a>
          </p>
        </div>
      )}

      {mode === "RECOVERY" && (
        <form onSubmit={onRecovery}>
          <input placeholder="Email" type="email" value={recoveryForm.email} onChange={(e) => setRecoveryForm((f) => ({ ...f, email: e.target.value }))} style={{ display: "block", width: "100%", padding: 8, marginBottom: 8 }} />
          <input placeholder="Mot de passe" type="password" value={recoveryForm.password} onChange={(e) => setRecoveryForm((f) => ({ ...f, password: e.target.value }))} style={{ display: "block", width: "100%", padding: 8, marginBottom: 8 }} />
          <input placeholder="Code de récupération (XXXX-XXXX-XXXX)" value={recoveryForm.code} onChange={(e) => setRecoveryForm((f) => ({ ...f, code: e.target.value }))} style={{ display: "block", width: "100%", padding: 8, marginBottom: 12 }} />
          <button disabled={busy} type="submit" style={{ padding: "10px 20px" }}>
            {busy ? "Vérification…" : "Récupérer l'accès"}
          </button>
        </form>
      )}
    </div>
  );
}
