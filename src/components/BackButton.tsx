"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

/**
 * Retour à l'historique réel du navigateur plutôt qu'à un lien fixe vers le
 * haut de la section (04/09/2026) : quand on ouvre le détail d'un produit
 * ou d'une variante depuis une liste filtrée/triée/scrollée, "Retour" doit
 * ramener EXACTEMENT à cet état, pas à la liste vierge — sinon l'utilisateur
 * doit recommencer son investigation depuis le début. `fallbackHref` ne sert
 * que si la page a été ouverte directement (pas d'historique dans l'app —
 * lien partagé, actualisation).
 */
export default function BackButton({ fallbackHref, label = "Retour" }: { fallbackHref: string; label?: string }) {
  const router = useRouter();

  function goBack() {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.push(fallbackHref);
    }
  }

  return (
    <button type="button" onClick={goBack} className="back-link">
      <ArrowLeft size={14} aria-hidden="true" />
      {label}
    </button>
  );
}
