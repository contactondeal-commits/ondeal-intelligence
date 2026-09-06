"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

/**
 * ONDEAL AI CORE — PHASE 5 : "AI Lab Ultimate" — Owner Control Center
 * (06/09/2026).
 *
 * Composant client UNIQUE, volontairement PAS découpé en 15 fichiers pour
 * cette première livraison réelle — chaque section appelle une VRAIE route
 * API (jamais une donnée codée en dur, jamais un état "success" affiché
 * sans réponse serveur réelle). §"NO CAPABILITY THEATER" : un tool/
 * connecteur NOT_CONFIGURED s'affiche tel quel, jamais masqué.
 */

type Tab = "composer" | "missions" | "tools" | "connectors" | "models" | "policy" | "audit";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "composer", label: "Composer" },
  { id: "missions", label: "Missions" },
  { id: "tools", label: "Tools" },
  { id: "connectors", label: "Connectors" },
  { id: "models", label: "Models" },
  { id: "policy", label: "Owner Control Center" },
  { id: "audit", label: "Audit" },
];

async function api<T = unknown>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...opts, headers: { "Content-Type": "application/json", ...(opts?.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Erreur HTTP ${res.status}`);
  return body as T;
}

function Badge({ tone, children }: { tone: "ok" | "warn" | "err" | "off" | "info"; children: React.ReactNode }) {
  const colors: Record<string, string> = {
    ok: "var(--color-success)",
    warn: "var(--color-warning)",
    err: "var(--color-danger)",
    off: "var(--color-text-faint)",
    info: "var(--color-info)",
  };
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.02em",
        padding: "2px 8px",
        borderRadius: 999,
        color: colors[tone],
        background: `color-mix(in srgb, ${colors[tone]} 16%, transparent)`,
        border: `1px solid color-mix(in srgb, ${colors[tone]} 40%, transparent)`,
        textTransform: "uppercase",
      }}
    >
      {children}
    </span>
  );
}

function healthTone(status: string): "ok" | "warn" | "err" | "off" | "info" {
  switch (status) {
    case "AVAILABLE":
    case "CONNECTED":
    case "ALLOW_AUTO":
    case "SUCCEEDED":
    case "SUCCESS":
      return "ok";
    case "DEGRADED":
    case "READ_ONLY":
    case "REQUIRE_APPROVAL":
    case "PAUSED":
    case "PENDING":
    case "RUNNING":
      return "warn";
    case "UNAVAILABLE":
    case "ERROR":
    case "DENY":
    case "FAILED":
    case "FAILURE":
    case "DENIED":
    case "CANCELLED":
      return "err";
    case "NOT_CONFIGURED":
    case "NOT_CONNECTED":
    case "DISABLED":
    case "SKIPPED":
      return "off";
    default:
      return "info";
  }
}

const cardStyle: React.CSSProperties = {
  background: "var(--color-surface)",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-lg)",
  padding: "var(--space-5)",
  boxShadow: "var(--shadow-card)",
};

const inputStyle: React.CSSProperties = {
  background: "var(--color-surface-alt)",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-sm)",
  color: "var(--color-text)",
  padding: "8px 10px",
  fontSize: 13,
  width: "100%",
};

const buttonStyle: React.CSSProperties = {
  background: "var(--color-primary)",
  color: "white",
  border: "none",
  borderRadius: "var(--radius-sm)",
  padding: "9px 16px",
  fontSize: 13,
  fontWeight: 700,
  cursor: "pointer",
};

const secondaryButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  background: "var(--color-surface-alt)",
  color: "var(--color-text)",
  border: "1px solid var(--color-border-strong)",
};

export default function AiLabConsole({ ownerEmail }: { ownerEmail: string }) {
  const [tab, setTab] = useState<Tab>("composer");
  const [policy, setPolicy] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshPolicy = useCallback(() => {
    api<{ policy: Record<string, unknown> }>("/api/ai-lab/policy").then((r) => setPolicy(r.policy)).catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    refreshPolicy();
  }, [refreshPolicy]);

  const killSwitchEngaged = Boolean(policy?.killSwitchEngaged);

  return (
    <div style={{ minHeight: "100vh", background: "var(--color-bg)", color: "var(--color-text)", fontFamily: "var(--font-inter), system-ui, sans-serif" }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "var(--space-4) var(--space-6)",
          borderBottom: "1px solid var(--color-border)",
          position: "sticky",
          top: 0,
          background: "var(--color-bg)",
          zIndex: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Link href="/dashboard" style={{ color: "var(--color-text-muted)", fontSize: 13, textDecoration: "none" }}>
            ← Dashboard
          </Link>
          <strong style={{ fontSize: 16 }}>OnDeal AI Lab — Ultimate</strong>
          {killSwitchEngaged ? <Badge tone="err">KILL SWITCH ENGAGED</Badge> : <Badge tone="ok">SYSTEM LIVE</Badge>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 12, color: "var(--color-text-faint)" }}>{ownerEmail} — Platform Owner</span>
          <button
            style={{ ...buttonStyle, background: killSwitchEngaged ? "var(--color-success)" : "var(--color-danger)" }}
            onClick={async () => {
              const reason = killSwitchEngaged ? null : window.prompt("Raison du Kill Switch (visible dans l'audit) :", "Arrêt d'urgence Owner") ?? "Arrêt d'urgence Owner";
              await api("/api/ai-lab/policy", { method: "PATCH", body: JSON.stringify({ killSwitchEngaged: !killSwitchEngaged, killSwitchReason: reason }) }).catch((e) => setError(String(e)));
              refreshPolicy();
            }}
          >
            {killSwitchEngaged ? "Désengager Kill Switch" : "KILL SWITCH — Tout arrêter"}
          </button>
        </div>
      </header>

      {error && (
        <div style={{ margin: "var(--space-4) var(--space-6)", padding: "var(--space-3)", background: "var(--color-danger-soft)", color: "var(--color-danger)", borderRadius: "var(--radius-sm)" }}>
          {error} <button onClick={() => setError(null)} style={{ marginLeft: 8, background: "none", border: "none", color: "inherit", cursor: "pointer" }}>✕</button>
        </div>
      )}

      <nav style={{ display: "flex", gap: 4, padding: "0 var(--space-6)", borderBottom: "1px solid var(--color-border)" }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              background: "none",
              border: "none",
              borderBottom: tab === t.id ? "2px solid var(--color-primary)" : "2px solid transparent",
              color: tab === t.id ? "var(--color-text)" : "var(--color-text-muted)",
              padding: "12px 14px",
              fontSize: 13,
              fontWeight: tab === t.id ? 700 : 500,
              cursor: "pointer",
            }}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main style={{ padding: "var(--space-6)", maxWidth: 1100, margin: "0 auto" }}>
        {tab === "composer" && <ComposerTab onError={setError} />}
        {tab === "missions" && <MissionsTab onError={setError} />}
        {tab === "tools" && <ToolsTab onError={setError} />}
        {tab === "connectors" && <ConnectorsTab onError={setError} />}
        {tab === "models" && <ModelsTab onError={setError} />}
        {tab === "policy" && <PolicyTab policy={policy} onChanged={refreshPolicy} onError={setError} />}
        {tab === "audit" && <AuditTab onError={setError} />}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// COMPOSER
// ---------------------------------------------------------------------------
function ComposerTab({ onError }: { onError: (e: string) => void }) {
  const [goal, setGoal] = useState("");
  const [environment, setEnvironment] = useState("SANDBOX");
  const [autonomyLevel, setAutonomyLevel] = useState("ASSIST");
  const [hardBudgetUsd, setHardBudgetUsd] = useState("5");
  const [storeId, setStoreId] = useState("");
  const [attachments, setAttachments] = useState<Array<{ id: string; filename: string; kind: string; parseStatus: string }>>([]);
  const [launching, setLaunching] = useState(false);
  const [launched, setLaunched] = useState<{ missionId: string } | null>(null);

  async function uploadFile(file: File) {
    const form = new FormData();
    form.set("file", file);
    const res = await fetch("/api/ai-lab/attachments", { method: "POST", body: form });
    const body = await res.json();
    if (!res.ok) {
      onError(body.error ?? "Échec de l'upload.");
      return;
    }
    setAttachments((prev) => [...prev, body.attachment]);
  }

  async function launch() {
    setLaunching(true);
    setLaunched(null);
    try {
      const created = await api<{ mission: { id: string } }>("/api/ai-lab/missions", {
        method: "POST",
        body: JSON.stringify({
          goal,
          environment,
          autonomyLevel,
          hardBudgetUsd: hardBudgetUsd ? Number(hardBudgetUsd) : undefined,
          storeId: storeId || undefined,
          attachmentIds: attachments.map((a) => a.id),
        }),
      });
      setLaunched({ missionId: created.mission.id });
      // Déclenche l'exécution — bornée par le mur d'exécution serverless
      // (voir /api/ai-lab/missions/[id]/run) : pour une mission de pure
      // cognition, ceci ira jusqu'au bout ici même ; pour une mission avec
      // "coder_implementation", voir scripts/run-ai-lab-mission.ts.
      await api(`/api/ai-lab/missions/${created.mission.id}/run`, { method: "POST" });
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setLaunching(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: "var(--space-5)" }}>
      <div style={cardStyle}>
        <h2 style={{ margin: 0, fontSize: 15 }}>Nouvelle mission</h2>
        <p style={{ color: "var(--color-text-muted)", fontSize: 13, marginTop: 4 }}>
          Objectif en langage naturel — n&apos;importe quoi : recherche, analyse de données, revue de code, refonte visuelle candidate (sandbox), ou une combinaison. Le Supervisor décompose lui-même en graphe.
        </p>
        <textarea
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder='Ex. "Analyse le stock à risque de rupture et propose une action, avec preuve chiffrée réelle."'
          rows={4}
          style={{ ...inputStyle, marginTop: 10, resize: "vertical" }}
        />

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10, marginTop: 12 }}>
          <label style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
            Environment
            <select value={environment} onChange={(e) => setEnvironment(e.target.value)} style={{ ...inputStyle, marginTop: 4 }}>
              <option value="SANDBOX">SANDBOX</option>
              <option value="PREVIEW">PREVIEW</option>
              <option value="PRODUCTION">PRODUCTION (refusé sans bascule Owner)</option>
            </select>
          </label>
          <label style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
            Autonomy Level
            <select value={autonomyLevel} onChange={(e) => setAutonomyLevel(e.target.value)} style={{ ...inputStyle, marginTop: 4 }}>
              <option value="ASSIST">ASSIST</option>
              <option value="AUTONOMOUS">AUTONOMOUS</option>
              <option value="DEEP">DEEP</option>
              <option value="ULTIMATE">ULTIMATE</option>
            </select>
          </label>
          <label style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
            Hard Budget (USD)
            <input value={hardBudgetUsd} onChange={(e) => setHardBudgetUsd(e.target.value)} style={{ ...inputStyle, marginTop: 4 }} />
          </label>
          <label style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
            Store ID (optionnel)
            <input value={storeId} onChange={(e) => setStoreId(e.target.value)} placeholder="Aucune boutique ciblée" style={{ ...inputStyle, marginTop: 4 }} />
          </label>
        </div>

        <div style={{ marginTop: 14 }}>
          <label style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
            Pièces jointes (PDF, DOCX, XLSX, CSV, JSON, TXT, MD, code)
            <input type="file" onChange={(e) => e.target.files?.[0] && uploadFile(e.target.files[0])} style={{ display: "block", marginTop: 4, fontSize: 12 }} />
          </label>
          {attachments.length > 0 && (
            <ul style={{ marginTop: 8, paddingLeft: 18, fontSize: 12, color: "var(--color-text-muted)" }}>
              {attachments.map((a) => (
                <li key={a.id}>
                  {a.filename} — {a.kind} — <Badge tone={healthTone(a.parseStatus)}>{a.parseStatus}</Badge>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div style={{ marginTop: 16, display: "flex", gap: 10 }}>
          <button style={buttonStyle} disabled={!goal || launching} onClick={launch}>
            {launching ? "Lancement…" : "Lancer la mission"}
          </button>
          {launched && (
            <span style={{ fontSize: 13, color: "var(--color-success)", alignSelf: "center" }}>
              Mission créée : {launched.missionId} — voir l&apos;onglet Missions pour le graphe en direct.
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MISSIONS
// ---------------------------------------------------------------------------
interface MissionSummary {
  id: string;
  goal: string;
  status: string;
  environment: string;
  autonomyLevel: string;
  totalCostUsd: number | null;
  lastError: string | null;
  createdAt: string;
}
interface MissionDetail {
  mission: MissionSummary & { resultJson: unknown };
  nodes: Array<{ id: string; key: string; role: string; status: string; dependsOn: string[]; output: { findings: string[]; evidence: string[]; recommendations: string[]; confidence: number } | null; provider: string | null; model: string | null; costUsd: number | null }>;
  artifacts: Array<{ id: string; kind: string; storageRef: string }>;
  auditLogs: Array<{ id: string; action: string; reason: string; resultStatus: string | null; createdAt: string }>;
  attachments: Array<{ id: string; filename: string; kind: string; parseStatus: string }>;
}

function MissionsTab({ onError }: { onError: (e: string) => void }) {
  const [missions, setMissions] = useState<MissionSummary[]>([]);
  const [selected, setSelected] = useState<MissionDetail | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(() => {
    api<{ missions: MissionSummary[] }>("/api/ai-lab/missions").then((r) => setMissions(r.missions)).catch((e) => onError(String(e)));
  }, [onError]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [refresh]);

  async function open(id: string) {
    setLoading(true);
    try {
      const detail = await api<MissionDetail>(`/api/ai-lab/missions/${id}`);
      setSelected(detail);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function cancel(id: string) {
    await api(`/api/ai-lab/missions/${id}/cancel`, { method: "POST" }).catch((e) => onError(String(e)));
    if (selected?.mission.id === id) open(id);
    refresh();
  }

  async function rerun(id: string) {
    await api(`/api/ai-lab/missions/${id}/run`, { method: "POST" }).catch((e) => onError(String(e)));
    open(id);
    refresh();
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: "var(--space-5)" }}>
      <div style={cardStyle}>
        <h3 style={{ margin: 0, fontSize: 14 }}>Historique ({missions.length})</h3>
        <div style={{ marginTop: 10, display: "grid", gap: 6, maxHeight: 600, overflowY: "auto" }}>
          {missions.map((m) => (
            <button
              key={m.id}
              onClick={() => open(m.id)}
              style={{
                textAlign: "left",
                background: selected?.mission.id === m.id ? "var(--color-surface-alt)" : "transparent",
                border: "1px solid var(--color-border)",
                borderRadius: "var(--radius-sm)",
                padding: 8,
                cursor: "pointer",
                color: "var(--color-text)",
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.goal}</div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <Badge tone={healthTone(m.status)}>{m.status}</Badge>
                <span style={{ fontSize: 11, color: "var(--color-text-faint)" }}>{m.environment} · {m.autonomyLevel}</span>
              </div>
            </button>
          ))}
          {missions.length === 0 && <p style={{ fontSize: 12, color: "var(--color-text-faint)" }}>Aucune mission encore — lancez-en une depuis Composer.</p>}
        </div>
      </div>

      <div style={cardStyle}>
        {loading && <p>Chargement…</p>}
        {!loading && !selected && <p style={{ color: "var(--color-text-faint)" }}>Sélectionnez une mission pour voir son graphe, ses artefacts et son audit.</p>}
        {!loading && selected && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 15 }}>{selected.mission.goal}</h3>
                <div style={{ marginTop: 6, display: "flex", gap: 8, alignItems: "center" }}>
                  <Badge tone={healthTone(selected.mission.status)}>{selected.mission.status}</Badge>
                  <span style={{ fontSize: 12, color: "var(--color-text-faint)" }}>
                    Coût : {selected.mission.totalCostUsd != null ? `${selected.mission.totalCostUsd.toFixed(4)} USD` : "—"}
                  </span>
                </div>
                {selected.mission.lastError && <p style={{ fontSize: 12, color: "var(--color-danger)", marginTop: 6 }}>{selected.mission.lastError}</p>}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                {["PLANNING", "RUNNING", "PAUSED"].includes(selected.mission.status) && (
                  <>
                    <button style={secondaryButtonStyle} onClick={() => rerun(selected.mission.id)}>Reprendre</button>
                    <button style={{ ...secondaryButtonStyle, color: "var(--color-danger)" }} onClick={() => cancel(selected.mission.id)}>Annuler</button>
                  </>
                )}
              </div>
            </div>

            <h4 style={{ fontSize: 13, marginTop: 18 }}>Graphe ({selected.nodes.length} nodes)</h4>
            <div style={{ display: "grid", gap: 6 }}>
              {selected.nodes.map((n) => (
                <details key={n.id} style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)", padding: 8 }}>
                  <summary style={{ cursor: "pointer", display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}>
                    <Badge tone={healthTone(n.status)}>{n.status}</Badge>
                    <strong>{n.key}</strong>
                    <span style={{ color: "var(--color-text-faint)" }}>({n.role})</span>
                    {n.dependsOn.length > 0 && <span style={{ color: "var(--color-text-faint)" }}>← {n.dependsOn.join(", ")}</span>}
                    {n.costUsd != null && <span style={{ marginLeft: "auto", color: "var(--color-text-faint)" }}>{n.costUsd.toFixed(4)} USD</span>}
                  </summary>
                  {n.output && (
                    <div style={{ marginTop: 8, fontSize: 12, color: "var(--color-text-muted)" }}>
                      <p><strong>Findings :</strong> {n.output.findings.join(" · ") || "—"}</p>
                      <p><strong>Evidence :</strong> {n.output.evidence.join(" · ") || "—"}</p>
                      <p><strong>Recommandations :</strong> {n.output.recommendations.join(" · ") || "—"}</p>
                      <p><strong>Confiance :</strong> {n.output.confidence}</p>
                      {n.model && <p style={{ color: "var(--color-text-faint)" }}>{n.provider}/{n.model}</p>}
                    </div>
                  )}
                </details>
              ))}
            </div>

            {selected.artifacts.length > 0 && (
              <>
                <h4 style={{ fontSize: 13, marginTop: 18 }}>Artefacts ({selected.artifacts.length})</h4>
                <ul style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
                  {selected.artifacts.map((a) => (
                    <li key={a.id}>{a.kind} — {a.storageRef}</li>
                  ))}
                </ul>
              </>
            )}

            {selected.attachments.length > 0 && (
              <>
                <h4 style={{ fontSize: 13, marginTop: 18 }}>Pièces jointes</h4>
                <ul style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
                  {selected.attachments.map((a) => (
                    <li key={a.id}>{a.filename} ({a.kind}, {a.parseStatus})</li>
                  ))}
                </ul>
              </>
            )}

            <h4 style={{ fontSize: 13, marginTop: 18 }}>Décisions & Audit (Evidence Panel)</h4>
            <ul style={{ fontSize: 11, color: "var(--color-text-faint)", maxHeight: 200, overflowY: "auto" }}>
              {selected.auditLogs.map((l) => (
                <li key={l.id}>
                  <Badge tone={healthTone(l.resultStatus ?? l.action)}>{l.action}</Badge> {l.reason}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TOOLS
// ---------------------------------------------------------------------------
function ToolsTab({ onError }: { onError: (e: string) => void }) {
  const [tools, setTools] = useState<Array<{ id: string; name: string; description: string; category: string; readWrite: string; riskClass: string; health: { status: string; detail: string } }>>([]);
  useEffect(() => {
    api<{ tools: typeof tools }>("/api/ai-lab/tools").then((r) => setTools(r.tools)).catch((e) => onError(String(e)));
  }, [onError]);

  return (
    <div style={{ display: "grid", gap: 10 }}>
      {tools.map((t) => (
        <div key={t.id} style={cardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <strong style={{ fontSize: 13 }}>{t.name}</strong>
            <Badge tone={healthTone(t.health.status)}>{t.health.status}</Badge>
          </div>
          <p style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: 4 }}>{t.description}</p>
          <p style={{ fontSize: 11, color: "var(--color-text-faint)", marginTop: 4 }}>{t.category} · {t.readWrite} · risque {t.riskClass} — {t.health.detail}</p>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CONNECTORS
// ---------------------------------------------------------------------------
function ConnectorsTab({ onError }: { onError: (e: string) => void }) {
  const [connectors, setConnectors] = useState<Array<{ id: string; name: string; category: string; hasRealImplementation: boolean; requiredSecrets: string[]; ownerOnly: boolean; merchantAvailable: boolean; health: { status: string; detail: string } }>>([]);
  useEffect(() => {
    api<{ connectors: typeof connectors }>("/api/ai-lab/connectors").then((r) => setConnectors(r.connectors)).catch((e) => onError(String(e)));
  }, [onError]);

  const byCategory = new Map<string, typeof connectors>();
  for (const c of connectors) {
    byCategory.set(c.category, [...(byCategory.get(c.category) ?? []), c]);
  }

  return (
    <div style={{ display: "grid", gap: 18 }}>
      {[...byCategory.entries()].map(([category, list]) => (
        <div key={category}>
          <h3 style={{ fontSize: 13, color: "var(--color-text-faint)", textTransform: "uppercase", letterSpacing: "0.04em" }}>{category}</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 10, marginTop: 8 }}>
            {list.map((c) => (
              <div key={c.id} style={cardStyle}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <strong style={{ fontSize: 13 }}>{c.name}</strong>
                  <Badge tone={healthTone(c.health.status)}>{c.health.status}</Badge>
                </div>
                <p style={{ fontSize: 11, color: "var(--color-text-faint)", marginTop: 6 }}>{c.health.detail}</p>
                {!c.hasRealImplementation && c.requiredSecrets.length > 0 && (
                  <p style={{ fontSize: 10, color: "var(--color-text-faint)", marginTop: 4 }}>Nécessiterait : {c.requiredSecrets.join(", ")}</p>
                )}
                <p style={{ fontSize: 10, color: "var(--color-text-faint)", marginTop: 4 }}>{c.ownerOnly ? "Owner uniquement" : "Disponible marchand"}</p>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// MODELS
// ---------------------------------------------------------------------------
function ModelsTab({ onError }: { onError: (e: string) => void }) {
  const [models, setModels] = useState<Array<{ provider: string; model: string; isDefault: boolean; capabilities: { maxContextTokens: number; vision: boolean; costPerMTokIn: number; costPerMTokOut: number } | null; gauntlet: { totalRuns: number; passRate: number | null; avgCostUsd: number | null } }>>([]);
  useEffect(() => {
    api<{ models: typeof models }>("/api/ai-lab/models").then((r) => setModels(r.models)).catch((e) => onError(String(e)));
  }, [onError]);

  return (
    <div style={{ display: "grid", gap: 10 }}>
      {models.map((m) => (
        <div key={m.model} style={cardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <strong style={{ fontSize: 13 }}>{m.provider} / {m.model}</strong>
            {m.isDefault && <Badge tone="info">AUTO ROUTER DEFAULT</Badge>}
          </div>
          {m.capabilities && (
            <p style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: 6 }}>
              Contexte {m.capabilities.maxContextTokens.toLocaleString("fr-FR")} tokens · Vision {m.capabilities.vision ? "oui" : "non"} · {m.capabilities.costPerMTokIn}$/{m.capabilities.costPerMTokOut}$ par million tokens (in/out)
            </p>
          )}
          <p style={{ fontSize: 11, color: "var(--color-text-faint)", marginTop: 4 }}>
            Gauntlet : {m.gauntlet.totalRuns} run(s) réel(s) — {m.gauntlet.passRate != null ? `${Math.round(m.gauntlet.passRate * 100)}% réussite` : "aucune donnée encore"}
            {m.gauntlet.avgCostUsd != null && ` · ${m.gauntlet.avgCostUsd.toFixed(4)} USD/appel moyen`}
          </p>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// POLICY (Owner Control Center)
// ---------------------------------------------------------------------------
function PolicyTab({ policy, onChanged, onError }: { policy: Record<string, unknown> | null; onChanged: () => void; onError: (e: string) => void }) {
  if (!policy) return <p>Chargement…</p>;
  // `key` force un remount (donc une réinitialisation propre des champs
  // contrôlés) quand la politique change sous nos pieds (ex. après save()
  // ou une modification depuis un autre onglet/navigateur) — jamais un
  // setState synchrone dans un effet (voir react-hooks/set-state-in-effect).
  return <PolicyForm key={JSON.stringify(policy)} policy={policy} onChanged={onChanged} onError={onError} />;
}

function PolicyForm({ policy, onChanged, onError }: { policy: Record<string, unknown>; onChanged: () => void; onError: (e: string) => void }) {
  const [maxBudget, setMaxBudget] = useState(String(policy.maxHardBudgetUsdGlobal ?? 20));
  const [autonomy, setAutonomy] = useState(String(policy.defaultAutonomyLevel ?? "ASSIST"));
  const [prodAllowed, setProdAllowed] = useState(Boolean(policy.productionEffectsAllowed));

  async function save() {
    try {
      await api("/api/ai-lab/policy", {
        method: "PATCH",
        body: JSON.stringify({ maxHardBudgetUsdGlobal: Number(maxBudget), defaultAutonomyLevel: autonomy, productionEffectsAllowed: prodAllowed }),
      });
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div style={{ display: "grid", gap: "var(--space-5)" }}>
      <div style={cardStyle}>
        <h3 style={{ margin: 0, fontSize: 14 }}>Souveraineté Owner — politique globale</h3>
        <p style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: 4 }}>
          Ces réglages sont appliqués RÉELLEMENT par le Policy Engine (src/lib/ai/policy/engine.ts) à CHAQUE itération de CHAQUE mission — jamais décoratifs.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 14 }}>
          <label style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
            Plafond budget ABSOLU (USD, toutes missions)
            <input value={maxBudget} onChange={(e) => setMaxBudget(e.target.value)} style={{ ...inputStyle, marginTop: 4 }} />
          </label>
          <label style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
            Niveau d&apos;autonomie par défaut
            <select value={autonomy} onChange={(e) => setAutonomy(e.target.value)} style={{ ...inputStyle, marginTop: 4 }}>
              <option value="ASSIST">ASSIST</option>
              <option value="AUTONOMOUS">AUTONOMOUS</option>
              <option value="DEEP">DEEP</option>
              <option value="ULTIMATE">ULTIMATE</option>
            </select>
          </label>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, fontSize: 12 }}>
          <input type="checkbox" checked={prodAllowed} onChange={(e) => setProdAllowed(e.target.checked)} />
          Autoriser les effets de PRODUCTION (reste REQUIRE_APPROVAL au cas par cas même une fois activé — jamais ALLOW_AUTO)
        </label>
        <button style={{ ...buttonStyle, marginTop: 14 }} onClick={save}>Enregistrer la politique</button>
      </div>

      <div style={cardStyle}>
        <h3 style={{ margin: 0, fontSize: 14 }}>État actuel</h3>
        <pre style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 8, whiteSpace: "pre-wrap" }}>{JSON.stringify(policy, null, 2)}</pre>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AUDIT
// ---------------------------------------------------------------------------
function AuditTab({ onError }: { onError: (e: string) => void }) {
  const [logs, setLogs] = useState<Array<{ id: string; missionId: string | null; action: string; decision: string | null; reason: string; resultStatus: string | null; createdAt: string }>>([]);
  useEffect(() => {
    api<{ logs: typeof logs }>("/api/ai-lab/audit").then((r) => setLogs(r.logs)).catch((e) => onError(String(e)));
  }, [onError]);

  return (
    <div style={cardStyle}>
      <h3 style={{ margin: 0, fontSize: 14 }}>Audit Trail ({logs.length})</h3>
      <div style={{ marginTop: 10, display: "grid", gap: 6, fontSize: 12 }}>
        {logs.map((l) => (
          <div key={l.id} style={{ display: "flex", gap: 8, borderBottom: "1px solid var(--color-border)", paddingBottom: 6 }}>
            <span style={{ color: "var(--color-text-faint)", minWidth: 140 }}>{new Date(l.createdAt).toLocaleString("fr-FR")}</span>
            <Badge tone={healthTone(l.resultStatus ?? l.decision ?? l.action)}>{l.action}</Badge>
            <span style={{ color: "var(--color-text-muted)" }}>{l.reason}</span>
          </div>
        ))}
        {logs.length === 0 && <p style={{ color: "var(--color-text-faint)" }}>Aucune entrée encore.</p>}
      </div>
    </div>
  );
}
