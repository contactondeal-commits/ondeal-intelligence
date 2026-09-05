"use client";

import { useEffect, useRef, useState } from "react";

type Message = { role: "user" | "assistant"; text: string; generatedBy?: "rules" | "llm" };

/**
 * LOT 10 (05/09/2026) — Copilot contextuel.
 * - `initialQuestion` : pré-remplit et envoie automatiquement la question
 *   arrivée en query string (barre de commande) — corrige un vrai bug où ce
 *   paramètre était transmis par le lien mais jamais lu par cette page.
 * - `contextProduct` : quand présent, une fiche produit est "épinglée" à la
 *   conversation — chaque question envoyée inclut alors son id, permettant
 *   à l'assistant de répondre à "ce produit"/"cette fiche" avec les vraies
 *   données de CE produit (résolues côté route API, jamais ici). L'utilisateur
 *   peut retirer ce contexte à tout moment (badge avec ✕) sans quitter la page.
 */
export default function AssistantChat({
  storeId,
  suggested,
  initialQuestion,
  contextProduct,
}: {
  storeId: string;
  suggested: string[];
  initialQuestion?: string | null;
  contextProduct?: { id: string; title: string } | null;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [pinnedProduct, setPinnedProduct] = useState(contextProduct ?? null);
  const askedInitialRef = useRef(false);

  async function ask(question: string) {
    if (!question.trim()) return;
    setMessages((m) => [...m, { role: "user", text: question }]);
    setInput("");
    setBusy(true);
    const res = await fetch("/api/assistant/query", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        storeId,
        question,
        ...(pinnedProduct ? { contextProductId: pinnedProduct.id } : {}),
      }),
    });
    const data = await res.json().catch(() => null);
    setBusy(false);
    setMessages((m) => [...m, { role: "assistant", text: data?.answer ?? "Erreur.", generatedBy: data?.generatedBy }]);
  }

  // Envoie la question initiale une seule fois au montage (une navigation
  // ⌘K → "Demander au Copilot : ...", ou un lien "Demander à propos de ce
  // produit" avec une question déjà formulée) — jamais renvoyée à nouveau
  // sur un re-render (garde via ref, pas une dépendance d'effet).
  useEffect(() => {
    if (initialQuestion && !askedInitialRef.current) {
      askedInitialRef.current = true;
      void ask(initialQuestion);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuestion]);

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", minHeight: 480 }}>
      {pinnedProduct && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 12,
            padding: "6px 10px",
            borderRadius: 8,
            background: "var(--color-neutral-soft)",
            fontSize: 13,
            width: "fit-content",
          }}
        >
          <span>
            Contexte : <strong>{pinnedProduct.title}</strong>
          </span>
          <button
            type="button"
            onClick={() => setPinnedProduct(null)}
            aria-label="Retirer le contexte produit"
            style={{ border: "none", background: "none", cursor: "pointer", padding: 0, lineHeight: 1, opacity: 0.6 }}
          >
            ✕
          </button>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        {suggested.map((q) => (
          <button key={q} className="badge badge-neutral" style={{ cursor: "pointer", border: "none" }} onClick={() => ask(q)}>
            {q}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, marginBottom: 16 }}>
        {messages.length === 0 && <p className="unavailable-note">Posez une question ou cliquez sur une suggestion ci-dessus.</p>}
        {messages.map((m, i) => (
          <div key={i} style={{ marginBottom: 12, display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
            <div
              style={{
                maxWidth: "80%",
                padding: "10px 14px",
                borderRadius: 12,
                background: m.role === "user" ? "var(--color-primary)" : "var(--color-neutral-soft)",
                color: m.role === "user" ? "#fff" : "var(--color-text)",
                whiteSpace: "pre-wrap",
                fontSize: 14,
              }}
            >
              {m.text}
              {m.generatedBy && <div style={{ fontSize: 10.5, opacity: 0.6, marginTop: 4 }}>{m.generatedBy === "llm" ? "Reformulé par IA" : "Réponse déterministe"}</div>}
            </div>
          </div>
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
        style={{ display: "flex", gap: 8 }}
      >
        <input className="input" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Posez votre question…" disabled={busy} />
        <button className="btn btn-primary" type="submit" disabled={busy}>Envoyer</button>
      </form>
    </div>
  );
}
