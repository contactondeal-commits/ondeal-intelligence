"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Field = { key: string; label: string; placeholder: string; type?: string };

export default function IntegrationCard({
  storeId,
  provider,
  title,
  description,
  status,
  lastError,
  lastSyncedAt,
  fields,
  oauthInstall = false,
  manualHelp,
}: {
  storeId: string;
  provider: "SHOPIFY" | "JUDGEME";
  title: string;
  description: string;
  status: string;
  lastError: string | null;
  lastSyncedAt: string | null;
  fields: Field[];
  /**
   * Affiche le bouton "Connecter via Shopify" (recommandé, sans jeton) au
   * lieu de la saisie manuelle par défaut — voir /api/shopify/install
   * (linkStoreId) + /api/shopify/callback (attachShopifyToExistingStore).
   */
  oauthInstall?: boolean;
  /** Rappel visible juste au-dessus des champs manuels : quel jeton, quelles autorisations, où le trouver. */
  manualHelp?: React.ReactNode;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(status !== "CONNECTED");
  const [shopDomain, setShopDomain] = useState("");
  const [showManual, setShowManual] = useState(!oauthInstall);

  async function connect() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/integrations/connect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ storeId, provider, credentials: values }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Échec de connexion.");
      return;
    }
    setEditing(false);
    router.refresh();
  }

  async function disconnect() {
    setBusy(true);
    await fetch("/api/integrations/disconnect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ storeId, provider }),
    });
    setBusy(false);
    router.refresh();
  }

  function goToShopifyInstall() {
    const domain = shopDomain.trim();
    if (!domain) return;
    const url = `/api/shopify/install?shop=${encodeURIComponent(domain)}&linkStoreId=${encodeURIComponent(storeId)}`;
    window.location.href = url;
  }

  const statusBadge =
    status === "CONNECTED" ? (
      <span className="badge badge-suggestion">Connecté</span>
    ) : status === "ERROR" ? (
      <span className="badge badge-urgent">Erreur</span>
    ) : (
      <span className="badge badge-neutral">Non connecté</span>
    );

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <h3 style={{ fontSize: 15, fontWeight: 800 }}>{title}</h3>
        {statusBadge}
      </div>
      <p className="unavailable-note" style={{ marginBottom: 12 }}>{description}</p>

      {lastSyncedAt && <p style={{ fontSize: 12.5, color: "#6b6b85", marginBottom: 8 }}>Dernière synchronisation : {new Date(lastSyncedAt).toLocaleString("fr-FR")}</p>}
      {lastError && <div className="callout callout-error" style={{ fontSize: 12.5 }}>{lastError}</div>}
      {error && <div className="callout callout-error" style={{ fontSize: 12.5 }}>{error}</div>}

      {editing ? (
        <>
          {oauthInstall && (
            <div
              className="field"
              style={{
                marginBottom: showManual ? 18 : 0,
                paddingBottom: showManual ? 16 : 0,
                borderBottom: showManual ? "1px solid var(--color-border)" : "none",
              }}
            >
              <label>Domaine de votre boutique (recommandé — aucun jeton à chercher)</label>
              <input
                className="input"
                placeholder="ma-boutique.myshopify.com"
                value={shopDomain}
                onChange={(e) => setShopDomain(e.target.value)}
              />
              <button className="btn btn-primary" disabled={!shopDomain.trim()} onClick={goToShopifyInstall} style={{ width: "100%", marginTop: 8 }}>
                Connecter via Shopify
              </button>
              <p className="cell-sub" style={{ marginTop: 6 }}>
                Vous serez redirigé vers Shopify pour autoriser l&apos;accès, puis ramené automatiquement ici — sans
                perdre votre session.
              </p>
              {!showManual && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowManual(true)} style={{ marginTop: 10 }}>
                  Je préfère saisir un jeton manuellement
                </button>
              )}
            </div>
          )}

          {showManual && (
            <>
              {manualHelp && (
                <div className="callout callout-info" style={{ fontSize: 12.5, marginBottom: 12 }}>
                  {manualHelp}
                </div>
              )}
              {fields.map((f) => (
                <div className="field" key={f.key}>
                  <label>{f.label}</label>
                  <input
                    className="input"
                    type={f.type ?? "text"}
                    placeholder={f.placeholder}
                    value={values[f.key] ?? ""}
                    onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  />
                </div>
              ))}
              <button className="btn btn-primary" disabled={busy} onClick={connect} style={{ width: "100%" }}>
                {busy ? "Connexion…" : "Connecter"}
              </button>
            </>
          )}
        </>
      ) : (
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-secondary" onClick={() => setEditing(true)}>Modifier</button>
          <button className="btn btn-danger" disabled={busy} onClick={disconnect}>Déconnecter</button>
        </div>
      )}
    </div>
  );
}
