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
 * Contexte de boutique compact du header — nom + statut réel en un coup
 * d'œil ("NOM BOUTIQUE  ● LIVE"). Jamais simulé : reçoit directement
 * store.integrations (lu depuis la table Integration par requireStore).
 * Le détail (quelle intégration, depuis quand) reste accessible via le titre.
 */
export default function StoreChip({
  name,
  shopifyConnected,
  judgemeConnected,
  lastSyncedAt,
  isDemo,
}: {
  name: string;
  shopifyConnected: boolean;
  judgemeConnected: boolean;
  lastSyncedAt: Date | null;
  isDemo: boolean;
}) {
  if (isDemo) {
    return (
      <span className="store-chip" title="Boutique de démonstration — données fictives">
        <span className="store-chip-name">{name}</span>
        <span className="store-chip-live">
          <span className="status-dot warn" aria-hidden />
          Démo
        </span>
      </span>
    );
  }

  const connectedCount = Number(shopifyConnected) + Number(judgemeConnected);
  const tone = connectedCount === 2 ? "ok" : connectedCount === 1 ? "warn" : "off";
  const statusWord = connectedCount === 2 ? "Live" : connectedCount === 1 ? "Partiel" : "Hors ligne";
  const detail =
    connectedCount === 0
      ? "Aucune intégration connectée"
      : connectedCount === 1
        ? `${shopifyConnected ? "Shopify" : "Judge.me"} connecté seul`
        : "Shopify + Judge.me connectés";
  const title = `${detail}${lastSyncedAt ? ` — dernière synchronisation ${timeAgo(lastSyncedAt)}` : " — jamais synchronisé"}`;

  return (
    <span className="store-chip" title={title}>
      <span className="store-chip-name">{name}</span>
      <span className="store-chip-live">
        <span className={`status-dot ${tone}`} aria-hidden />
        {statusWord}
      </span>
    </span>
  );
}
