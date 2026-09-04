"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Primitive Modal générique — overlay + panel centré, fermeture au clic
 * extérieur et à Échap, focus renvoyé au déclencheur à la fermeture.
 * Base de la Command Bar et des futurs panneaux Simulation/Decision.
 */
export default function Modal({
  open,
  onClose,
  children,
  wide,
  labelledBy,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  labelledBy?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div ref={panelRef} className={`modal-panel ${wide ? "modal-panel-wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
        {children}
      </div>
    </div>
  );
}
