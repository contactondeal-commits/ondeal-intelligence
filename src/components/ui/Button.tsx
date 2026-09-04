"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "danger" | "ghost";
type Size = "sm" | "md";

const VARIANT_CLASS: Record<Variant, string> = {
  primary: "btn-primary",
  secondary: "btn-secondary",
  danger: "btn-danger",
  ghost: "btn-ghost",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  loading?: boolean;
}

/**
 * Primitive Button — seule source de vérité pour les boutons de l'app.
 * Toute nouvelle page doit utiliser ce composant plutôt que `<button className="btn ...">` en dur.
 */
export default function Button({ variant = "secondary", size = "md", icon, loading, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      className={["btn", VARIANT_CLASS[variant], size === "sm" ? "btn-sm" : "", className ?? ""].filter(Boolean).join(" ")}
      disabled={disabled || loading}
      {...rest}
    >
      {icon && <span className="btn-icon" aria-hidden>{icon}</span>}
      {children}
    </button>
  );
}
