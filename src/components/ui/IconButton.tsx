"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ReactNode;
  "aria-label": string;
}

/** Bouton icône seul — toujours avec un aria-label explicite (jamais d'icône muette). */
export default function IconButton({ icon, className, ...rest }: IconButtonProps) {
  return (
    <button className={["icon-btn", className ?? ""].filter(Boolean).join(" ")} {...rest}>
      {icon}
    </button>
  );
}
