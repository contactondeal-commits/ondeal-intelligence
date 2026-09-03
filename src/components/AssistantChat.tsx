"use client";

import { useState } from "react";

type Message = { role: "user" | "assistant"; text: string; generatedBy?: "rules" | "llm" };

export default function AssistantChat({ storeId, suggested }: { storeId: string; suggested: string[] }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  async function ask(question: string) {
    if (!question.trim()) return;
    setMessages((m) => [...m, { role: "user", text: question }]);
    setInput("");
    setBusy(true);
    const res = await fetch("/api/assistant/query", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ storeId, question }),
    });
    const data = await res.json().catch(() => null);
    setBusy(false);
    setMessages((m) => [...m, { role: "assistant", text: data?.answer ?? "Erreur.", generatedBy: data?.generatedBy }]);
  }

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", minHeight: 480 }}>
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
