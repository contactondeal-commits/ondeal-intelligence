"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// GOOGLE ANALYTICS — carte dédiée (05/09/2026), distincte d'IntegrationCard :
// le flux GA4 n'a ni jeton manuel ni installation "domaine boutique", mais
// une étape intermédiaire propre (choix de la propriété GA4 après le retour
// OAuth) qu'aucune des deux autres cartes ne modélise. Ne touche jamais au
// comportement d'IntegrationCard (chemin déjà vérifié en production).

export interface GaProperty {
  propertyId: string;
  displayName: string;
  accountDisplayName: string;
}

export default function GoogleAnalyticsCard({
  storeId,
  status,
  lastError,
  lastSyncedAt,
  propertyDisplayName,
  awaitingPropertySelection,
}: {
  storeId: string;
  status: string;
  lastError: string | null;
  lastSyncedAt: string | null;
  propertyDisplayName: string | null;
  /** Autorisation OAuth faite mais aucune propriété GA4 choisie encore — affiche le sélecteur. */
  awaitingPropertySelection: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [properties, setProperties] = useState<GaProperty[] | null>(null);
  const [loadingProperties, setLoadingProperties] = useState(false);

  function connect() {
    window.location.href = `/api/integrations/google-analytics/install?store=${encodeURIComponent(storeId)}`;
  }

  async function disconnect() {
    setBusy(true);
    await fetch("/api/integrations/disconnect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ storeId, provider: "GOOGLE_ANALYTICS" }),
    });
    setBusy(false);
    router.refresh();
  }

  async function loadProperties() {
    setLoadingProperties(true);
    setError(null);
    const res = await fetch(`/api/integrations/google-analytics/properties?store=${encodeURIComponent(storeId)}`);
    const data = await res.json().catch(() => ({}));
    setLoadingProperties(false);
    if (!res.ok) {
      setError(data.error ?? "Impossible de lister vos propriétés Google Analytics.");
      return;
    }
    setProperties(data.properties ?? []);
  }

  async function selectProperty(propertyId: string, displayName: string) {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/integrations/google-analytics/select-property", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ storeId, propertyId, displayName }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Échec de la sélection de la propriété.");
      return;
    }
    setProperties(null);
    router.refresh();
  }

  const statusBadge =
    status === "CONNECTED" && !awaitingPropertySelection ? (
      <span className="badge badge-suggestion">Connecté</span>
    ) : status === "ERROR" ? (
      <span className="badge badge-urgent">Erreur</span>
    ) : status === "CONNECTED" && awaitingPropertySelection ? (
      <span className="badge badge-neutral">Propriété à choisir</span>
    ) : (
      <span className="badge badge-neutral">Non connecté</span>
    );

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <h3 style={{ fontSize: 15, fontWeight: 800 }}>Google Analytics (GA4)</h3>
        {statusBadge}
      </div>
      <p className="unavailable-note" style={{ marginBottom: 12 }}>
        Trafic et acquisition — sessions, canaux, conversions. Lecture seule : ne modifie jamais rien dans votre
        compte Google.
      </p>

      {lastSyncedAt && !awaitingPropertySelection && (
        <p style={{ fontSize: 12.5, color: "#6b6b85", marginBottom: 8 }}>
          Dernière synchronisation : {new Date(lastSyncedAt).toLocaleString("fr-FR")}
        </p>
      )}
      {propertyDisplayName && !awaitingPropertySelection && (
        <p style={{ fontSize: 12.5, color: "#6b6b85", marginBottom: 8 }}>Propriété : {propertyDisplayName}</p>
      )}
      {lastError && <div className="callout callout-error" style={{ fontSize: 12.5 }}>{lastError}</div>}
      {error && <div className="callout callout-error" style={{ fontSize: 12.5 }}>{error}</div>}

      {status !== "CONNECTED" && (
        <button className="btn btn-primary" disabled={busy} onClick={connect} style={{ width: "100%" }}>
          Connecter Google Analytics
        </button>
      )}

      {status === "CONNECTED" && awaitingPropertySelection && (
        <>
          {properties === null ? (
            <button className="btn btn-primary" disabled={loadingProperties} onClick={loadProperties} style={{ width: "100%" }}>
              {loadingProperties ? "Chargement…" : "Choisir ma propriété GA4"}
            </button>
          ) : properties.length === 0 ? (
            <p className="unavailable-note">Aucune propriété GA4 accessible pour ce compte Google.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {properties.map((p) => (
                <button
                  key={p.propertyId}
                  type="button"
                  className="btn btn-secondary"
                  disabled={busy}
                  onClick={() => selectProperty(p.propertyId, p.displayName)}
                  style={{ textAlign: "left" }}
                >
                  <strong>{p.displayName}</strong>
                  <span style={{ display: "block", fontSize: 12, color: "#6b6b85" }}>{p.accountDisplayName}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {status === "CONNECTED" && (
        <div style={{ display: "flex", gap: 8, marginTop: awaitingPropertySelection ? 12 : 0 }}>
          <button className="btn btn-danger" disabled={busy} onClick={disconnect}>Déconnecter</button>
        </div>
      )}
    </div>
  );
}
