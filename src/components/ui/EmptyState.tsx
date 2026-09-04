import type { ReactNode } from "react";

/**
 * État vide premium — jamais un simple "Aucune donnée". Explique toujours
 * pourquoi, ce qui manque, et ce que ça débloquera une fois résolu.
 */
export default function EmptyState({
  icon,
  title,
  reason,
  unlock,
  actions,
}: {
  icon?: ReactNode;
  title: string;
  /** Pourquoi c'est vide + ce qui manque concrètement */
  reason: string;
  /** Ce que ça débloquera une fois connecté/résolu */
  unlock?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="empty-state-premium">
      {icon && <span className="empty-state-icon" aria-hidden>{icon}</span>}
      <div className="empty-state-title">{title}</div>
      <div className="empty-state-reason">{reason}</div>
      {unlock && <div className="empty-state-unlock">{unlock}</div>}
      {actions && <div className="empty-state-actions">{actions}</div>}
    </div>
  );
}
