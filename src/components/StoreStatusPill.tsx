function timeAgo(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.floor(h / 24);
  return `il y a ${d} j`;
}

/**
 * Statut de connexion réel — jamais simulé. Reçoit directement
 * store.integrations (lu depuis la table Integration par requireStore).
 */
export default function StoreStatusPill({
  shopifyConnected,
  judgemeConnected,
  lastSyncedAt,
  isDemo,
}: {
  shopifyConnected: boolean;
  judgemeConnected: boolean;
  lastSyncedAt: Date | null;
  isDemo: boolean;
}) {
  if (isDemo) {
    return (
      <span className="store-status-pill">
        <span className="store-status-dot partial" />
        Boutique de démonstration
      </span>
    );
  }

  const connectedCount = Number(shopifyConnected) + Number(judgemeConnected);
  const dotClass = connectedCount === 2 ? "connected" : connectedCount === 1 ? "partial" : "disconnected";
  const label =
    connectedCount === 0
      ? "Aucune intégration connectée"
      : connectedCount === 1
        ? `${shopifyConnected ? "Shopify" : "Judge.me"} connecté`
        : "Shopify + Judge.me connectés";

  return (
    <span className="store-status-pill" title={lastSyncedAt ? `Dernière synchronisation ${timeAgo(lastSyncedAt)}` : "Jamais synchronisé"}>
      <span className={`store-status-dot ${dotClass}`} />
      {label}
      {lastSyncedAt && <span style={{ color: "var(--color-text-faint)" }}>· {timeAgo(lastSyncedAt)}</span>}
    </span>
  );
}
