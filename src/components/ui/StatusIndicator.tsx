export type StatusTone = "ok" | "warn" | "err" | "off";

/** Point de statut + libellé — remplace tout usage d'emoji (🟢🟠🔴⚪) pour indiquer un état. */
export default function StatusIndicator({ tone, label }: { tone: StatusTone; label: string }) {
  return (
    <span className="status-dot-label">
      <span className={`status-dot ${tone}`} aria-hidden />
      {label}
    </span>
  );
}
