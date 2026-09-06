"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { callWithStepUp } from "@/app/ai-lab/stepUp";

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

type Tab = "composer" | "missions" | "tools" | "connectors" | "models" | "agents" | "memory" | "experiments" | "evolution" | "policy" | "audit";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "composer", label: "Composer" },
  { id: "missions", label: "Missions" },
  { id: "tools", label: "Tools" },
  { id: "connectors", label: "Connectors" },
  { id: "models", label: "Models" },
  { id: "agents", label: "Agents" },
  { id: "memory", label: "Memory" },
  { id: "experiments", label: "Experiments" },
  { id: "evolution", label: "Evolution" },
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
        {tab === "agents" && <AgentsTab onError={setError} />}
        {tab === "memory" && <MemoryTab onError={setError} />}
        {tab === "experiments" && <ExperimentsTab onError={setError} />}
        {tab === "evolution" && <EvolutionTab onError={setError} />}
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

  // §12 "SSE temps réel" (06/09/2026) : la mission ouverte se met à jour
  // toute seule pendant qu'elle tourne — remplace le rafraîchissement
  // manuel (jusqu'ici, ouvrir une mission RUNNING ne se mettait à jour que
  // sur Reprendre/Annuler/re-clic). Un seul flux actif à la fois (une
  // mission ouverte à la fois) ; fermé dès que le statut devient terminal
  // ou que la mission ouverte change — jamais deux flux qui tournent en
  // parallèle pour rien.
  const [liveConnected, setLiveConnected] = useState(false);
  const streamedMissionId = selected?.mission.id;
  const streamedMissionStatus = selected?.mission.status;
  useEffect(() => {
    if (!streamedMissionId || !streamedMissionStatus || !["PLANNING", "RUNNING", "PAUSED"].includes(streamedMissionStatus)) {
      setLiveConnected(false);
      return;
    }
    const es = new EventSource(`/api/ai-lab/missions/${streamedMissionId}/stream`);
    es.addEventListener("open", () => setLiveConnected(true));
    es.addEventListener("mission", (evt) => {
      try {
        setSelected(JSON.parse((evt as MessageEvent).data) as MissionDetail);
      } catch {
        // Événement malformé — jamais un crash de l'UI ; on ignore cet événement et on garde le dernier état connu.
      }
    });
    // Une fermeture propre du flux serveur (fin de maxDuration, ou mission
    // devenue terminale côté serveur) déclenche une reconnexion NATIVE de
    // EventSource — comportement standard de la spec SSE, pas une erreur à
    // signaler à l'Owner ; on se contente de refléter l'état de connexion.
    es.addEventListener("error", () => setLiveConnected(false));
    return () => {
      es.close();
      setLiveConnected(false);
    };
  }, [streamedMissionId, streamedMissionStatus]);

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

  const [instructionText, setInstructionText] = useState("");
  const [instructionBusy, setInstructionBusy] = useState(false);
  async function addInstruction(id: string) {
    if (!instructionText.trim()) return;
    setInstructionBusy(true);
    try {
      await callWithStepUp(`/api/ai-lab/missions/${id}/instruction`, { method: "POST", body: JSON.stringify({ text: instructionText.trim() }) });
      setInstructionText("");
      open(id);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setInstructionBusy(false);
    }
  }

  const [dispatchBusy, setDispatchBusy] = useState(false);
  async function dispatchViaGithub(id: string) {
    setDispatchBusy(true);
    try {
      const r = await callWithStepUp<{ ok: boolean; detail?: string }>(`/api/ai-lab/missions/${id}/dispatch`, { method: "POST" });
      onError(`Dispatch GitHub Actions : ${r.detail ?? "déclenché"}`);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setDispatchBusy(false);
    }
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
                  {liveConnected && <Badge tone="ok">● EN DIRECT</Badge>}
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
                {selected.mission.environment !== "PRODUCTION" && (
                  <button disabled={dispatchBusy} style={secondaryButtonStyle} onClick={() => dispatchViaGithub(selected.mission.id)} title="Déclenche .github/workflows/ai-lab-mission.yml via l'API GitHub — nécessite le connecteur GitHub connecté (onglet Connectors)">
                    {dispatchBusy ? "Déclenchement…" : "Lancer via GitHub Actions"}
                  </button>
                )}
              </div>
            </div>

            {["PLANNING", "RUNNING", "PAUSED"].includes(selected.mission.status) && (
              <div style={{ marginTop: 14, padding: 10, border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)" }}>
                <label style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
                  Ajouter une instruction en cours de mission — prise en compte à la prochaine itération de la boucle (réplanification réelle, travail déjà accompli préservé)
                  <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                    <input value={instructionText} onChange={(e) => setInstructionText(e.target.value)} placeholder="Ex. « Vérifie aussi l'accessibilité clavier de la nouvelle page. »" style={inputStyle} />
                    <button disabled={instructionBusy || !instructionText.trim()} style={buttonStyle} onClick={() => addInstruction(selected.mission.id)}>
                      {instructionBusy ? "Envoi…" : "Ajouter"}
                    </button>
                  </div>
                </label>
              </div>
            )}

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
interface ConnectorEntry {
  id: string;
  name: string;
  category: string;
  hasRealImplementation: boolean;
  requiredSecrets: string[];
  ownerOnly: boolean;
  merchantAvailable: boolean;
  health: { status: string; detail: string };
}

function ConnectorsTab({ onError }: { onError: (e: string) => void }) {
  const [connectors, setConnectors] = useState<ConnectorEntry[]>([]);

  const refresh = useCallback(() => {
    api<{ connectors: ConnectorEntry[] }>("/api/ai-lab/connectors").then((r) => setConnectors(r.connectors)).catch((e) => onError(String(e)));
  }, [onError]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const byCategory = new Map<string, ConnectorEntry[]>();
  for (const c of connectors) {
    byCategory.set(c.category, [...(byCategory.get(c.category) ?? []), c]);
  }

  return (
    <div style={{ display: "grid", gap: 18 }}>
      {[...byCategory.entries()].map(([category, list]) => (
        <div key={category}>
          <h3 style={{ fontSize: 13, color: "var(--color-text-faint)", textTransform: "uppercase", letterSpacing: "0.04em" }}>{category}</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 10, marginTop: 8 }}>
            {list.map((c) =>
              c.id === "github" ? (
                <GithubConnectorCard key={c.id} connector={c} onChanged={refresh} onError={onError} />
              ) : (
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
              ),
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function GithubConnectorCard({ connector, onChanged, onError }: { connector: ConnectorEntry; onChanged: () => void; onError: (e: string) => void }) {
  const [showForm, setShowForm] = useState(false);
  const [token, setToken] = useState("");
  const [repoFullName, setRepoFullName] = useState("");
  const [busy, setBusy] = useState(false);
  const connected = connector.health.status === "CONNECTED" || connector.health.status === "AVAILABLE";

  async function connect() {
    setBusy(true);
    try {
      await callWithStepUp("/api/ai-lab/connectors/github/connect", { method: "POST", body: JSON.stringify({ token, repoFullName }) });
      setToken("");
      setShowForm(false);
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    try {
      const r = await api<{ ok: boolean; detail?: string }>("/api/ai-lab/connectors/github/test", { method: "POST" });
      onError(`GitHub — test réussi : ${r.detail ?? "connexion OK"}`);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (typeof window !== "undefined" && !window.confirm("Déconnecter le connecteur GitHub ? Les missions coder_implementation ne pourront plus être dispatchées via GitHub Actions.")) return;
    setBusy(true);
    try {
      await callWithStepUp("/api/ai-lab/connectors/github/disconnect", { method: "POST" });
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <strong style={{ fontSize: 13 }}>{connector.name}</strong>
        <Badge tone={healthTone(connector.health.status)}>{connector.health.status}</Badge>
      </div>
      <p style={{ fontSize: 11, color: "var(--color-text-faint)", marginTop: 6 }}>{connector.health.detail}</p>

      <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
        {!connected && !showForm && (
          <button style={buttonStyle} onClick={() => setShowForm(true)}>Connecter…</button>
        )}
        {connected && (
          <>
            <button disabled={busy} style={secondaryButtonStyle} onClick={test}>Tester</button>
            <button disabled={busy} style={{ ...secondaryButtonStyle, color: "var(--color-danger)" }} onClick={disconnect}>Déconnecter</button>
          </>
        )}
      </div>

      {showForm && (
        <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
          <input placeholder="Personal Access Token GitHub" type="password" value={token} onChange={(e) => setToken(e.target.value)} style={inputStyle} />
          <input placeholder="owner/repo (ex. contactondeal-commits/ondeal-intelligence)" value={repoFullName} onChange={(e) => setRepoFullName(e.target.value)} style={inputStyle} />
          <div style={{ display: "flex", gap: 6 }}>
            <button disabled={busy || !token || !repoFullName} style={buttonStyle} onClick={connect}>{busy ? "Vérification…" : "Vérifier et connecter"}</button>
            <button disabled={busy} style={secondaryButtonStyle} onClick={() => setShowForm(false)}>Annuler</button>
          </div>
          <p style={{ fontSize: 10, color: "var(--color-text-faint)" }}>Le jeton est vérifié RÉELLEMENT auprès de l&apos;API GitHub avant d&apos;être chiffré et stocké — jamais enregistré à l&apos;aveugle.</p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// MODELS — Model Console écrivable (§18), provider status/failover (§22-32)
// ---------------------------------------------------------------------------
interface ModelConsoleEntry {
  provider: string;
  model: string;
  isDefault: boolean;
  capabilities: { maxContextTokens: number; vision: boolean; costPerMTokIn: number; costPerMTokOut: number } | null;
  gauntlet: { totalRuns: number; passRate: number | null; avgCostUsd: number | null };
  configOverride: { enabled: boolean; isDefault: boolean; forceForTestUntil: string | null; maxCostPerCallUsd: number | null; providerPriority: number } | null;
  providerHealth?: { status: string; detail: string };
}

function ModelsTab({ onError }: { onError: (e: string) => void }) {
  const [models, setModels] = useState<ModelConsoleEntry[]>([]);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const refresh = useCallback(() => {
    callWithStepUp<{ models: ModelConsoleEntry[] }>("/api/ai-lab/models/config").then((r) => setModels(r.models)).catch((e) => onError(String(e)));
  }, [onError]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function patch(m: ModelConsoleEntry, patchBody: Record<string, unknown>) {
    const key = `${m.provider}::${m.model}`;
    setBusyKey(key);
    try {
      await callWithStepUp("/api/ai-lab/models/config", { method: "POST", body: JSON.stringify({ provider: m.provider, model: m.model, ...patchBody }) });
      refresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <p style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
        Contrôle RÉEL du Router/Failover (src/lib/ai/models/router.ts::resolveFailoverCandidates) — effet immédiat sur la prochaine mission. Les actions ci-dessous demandent un step-up WebAuthn (cérémonie proposée automatiquement).
      </p>
      {models.map((m) => {
        const key = `${m.provider}::${m.model}`;
        const enabled = m.configOverride?.enabled ?? true;
        const isDefault = m.configOverride?.isDefault ?? m.isDefault;
        const forced = m.configOverride?.forceForTestUntil && new Date(m.configOverride.forceForTestUntil).getTime() > Date.now();
        return (
          <div key={key} style={cardStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <strong style={{ fontSize: 13 }}>{m.provider} / {m.model}</strong>
              <div style={{ display: "flex", gap: 6 }}>
                {isDefault && <Badge tone="info">DEFAULT</Badge>}
                {forced && <Badge tone="warn">FORCED FOR TEST</Badge>}
                {!enabled && <Badge tone="off">DISABLED</Badge>}
                {m.providerHealth && <Badge tone={healthTone(m.providerHealth.status)}>{m.providerHealth.status}</Badge>}
              </div>
            </div>
            {m.capabilities && (
              <p style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: 6 }}>
                Contexte {m.capabilities.maxContextTokens.toLocaleString("fr-FR")} tokens · Vision {m.capabilities.vision ? "oui" : "non"} · {m.capabilities.costPerMTokIn}$/{m.capabilities.costPerMTokOut}$ par million tokens (in/out)
              </p>
            )}
            {m.providerHealth && <p style={{ fontSize: 11, color: "var(--color-text-faint)", marginTop: 2 }}>{m.providerHealth.detail}</p>}
            <p style={{ fontSize: 11, color: "var(--color-text-faint)", marginTop: 4 }}>
              Gauntlet : {m.gauntlet.totalRuns} run(s) réel(s) — {m.gauntlet.passRate != null ? `${Math.round(m.gauntlet.passRate * 100)}% réussite` : "aucune donnée encore"}
              {m.gauntlet.avgCostUsd != null && ` · ${m.gauntlet.avgCostUsd.toFixed(4)} USD/appel moyen`}
            </p>
            {m.configOverride?.providerPriority != null && m.configOverride.providerPriority !== 0 && (
              <p style={{ fontSize: 11, color: "var(--color-text-faint)" }}>Priorité failover : {m.configOverride.providerPriority}</p>
            )}
            {m.configOverride?.maxCostPerCallUsd != null && <p style={{ fontSize: 11, color: "var(--color-text-faint)" }}>Plafond coût/appel : {m.configOverride.maxCostPerCallUsd} USD</p>}
            <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
              <button disabled={busyKey === key} style={secondaryButtonStyle} onClick={() => patch(m, { enabled: !enabled })}>
                {enabled ? "Désactiver" : "Activer"}
              </button>
              <button disabled={busyKey === key || isDefault} style={secondaryButtonStyle} onClick={() => patch(m, { isDefault: true })}>
                Définir par défaut
              </button>
              <button
                disabled={busyKey === key}
                style={secondaryButtonStyle}
                onClick={() => {
                  const minutes = window.prompt("Forcer ce modèle pour TOUTE nouvelle mission pendant combien de minutes ?", "30");
                  if (minutes) patch(m, { forceForTestMinutes: Number(minutes) });
                }}
              >
                Forcer pour test…
              </button>
              {forced && (
                <button disabled={busyKey === key} style={secondaryButtonStyle} onClick={() => patch(m, { forceForTestMinutes: null })}>
                  Annuler le forçage
                </button>
              )}
              <button
                disabled={busyKey === key}
                style={secondaryButtonStyle}
                onClick={() => {
                  const cost = window.prompt("Plafond de coût par appel (USD, pire cas) — laisser vide pour aucun plafond :", m.configOverride?.maxCostPerCallUsd != null ? String(m.configOverride.maxCostPerCallUsd) : "");
                  if (cost === null) return;
                  patch(m, { maxCostPerCallUsd: cost.trim() === "" ? null : Number(cost) });
                }}
              >
                Plafond de coût…
              </button>
              <button
                disabled={busyKey === key}
                style={secondaryButtonStyle}
                onClick={() => {
                  const priority = window.prompt("Priorité failover (0 = essayé en premier) :", String(m.configOverride?.providerPriority ?? 0));
                  if (priority) patch(m, { providerPriority: Number(priority) });
                }}
              >
                Priorité…
              </button>
              {m.configOverride && (
                <button disabled={busyKey === key} style={{ ...secondaryButtonStyle, color: "var(--color-danger)" }} onClick={() => patch(m, { removeOverride: true })}>
                  Retirer l&apos;override
                </button>
              )}
            </div>
          </div>
        );
      })}
      {models.length === 0 && <p style={{ color: "var(--color-text-faint)" }}>Chargement…</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AGENTS — Dynamic Agent Registry + Owner Agent Control (§14-15)
// ---------------------------------------------------------------------------
interface AgentRegistryEntry {
  role: string;
  enabled: boolean;
  missionCount: number;
  successCount: number;
  failureCount: number;
  successRate: number | null;
  avgCostUsd: number | null;
  avgLatencyMs: number | null;
  modelsUsed: Array<{ provider: string; model: string; count: number }>;
}

function AgentsTab({ onError }: { onError: (e: string) => void }) {
  const [agents, setAgents] = useState<AgentRegistryEntry[]>([]);
  const [busyRole, setBusyRole] = useState<string | null>(null);

  const refresh = useCallback(() => {
    callWithStepUp<{ agents: AgentRegistryEntry[] }>("/api/ai-lab/agents").then((r) => setAgents(r.agents)).catch((e) => onError(String(e)));
  }, [onError]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function toggle(role: string, enabled: boolean) {
    setBusyRole(role);
    try {
      await callWithStepUp("/api/ai-lab/agents/config", { method: "POST", body: JSON.stringify({ role, enabled }) });
      refresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyRole(null);
    }
  }

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <p style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
        Statistiques réelles agrégées depuis les missions exécutées (StorefrontMissionNode). Désactiver un rôle a un effet runtime immédiat : il est retiré des rôles proposés au planner ET tout node existant qui le référence encore échoue explicitement (jamais une exécution silencieuse).
      </p>
      {agents.map((a) => (
        <div key={a.role} style={cardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <strong style={{ fontSize: 13 }}>{a.role}</strong>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              {!a.enabled && <Badge tone="off">DISABLED</Badge>}
              <button disabled={busyRole === a.role} style={secondaryButtonStyle} onClick={() => toggle(a.role, !a.enabled)}>
                {a.enabled ? "Désactiver" : "Réactiver"}
              </button>
            </div>
          </div>
          <p style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: 6 }}>
            {a.missionCount} mission(s) · {a.successCount} succès / {a.failureCount} échec(s)
            {a.successRate != null && ` · ${Math.round(a.successRate * 100)}% réussite`}
          </p>
          <p style={{ fontSize: 11, color: "var(--color-text-faint)", marginTop: 4 }}>
            {a.avgCostUsd != null ? `Coût moyen ${a.avgCostUsd.toFixed(4)} USD` : "Coût moyen inconnu"} · {a.avgLatencyMs != null ? `Latence moyenne ${Math.round(a.avgLatencyMs / 1000)}s` : "Latence inconnue"}
          </p>
          {a.modelsUsed.length > 0 && (
            <p style={{ fontSize: 11, color: "var(--color-text-faint)", marginTop: 4 }}>
              Modèles utilisés : {a.modelsUsed.map((mu) => `${mu.provider}/${mu.model} (${mu.count})`).join(", ")}
            </p>
          )}
        </div>
      ))}
      {agents.length === 0 && <p style={{ color: "var(--color-text-faint)" }}>Chargement…</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// MEMORY — Persistent Memory foundation (§57-60), lecture Owner
// ---------------------------------------------------------------------------
const MEMORY_SCOPES = ["WORKING", "EPISODIC", "BRAND", "DESIGN", "ENGINEERING", "FAILURE", "OUTCOME", "MODEL_PERFORMANCE"] as const;

function MemoryTab({ onError }: { onError: (e: string) => void }) {
  const [scope, setScope] = useState<string>("");
  const [records, setRecords] = useState<Array<{ id: string; scope: string; content: string; sourceKind: string; confidence: number; missionId: string | null; createdAt: string }>>([]);

  const refresh = useCallback(() => {
    const qs = scope ? `?scope=${scope}` : "";
    callWithStepUp<{ records: typeof records }>(`/api/ai-lab/memory${qs}`).then((r) => setRecords(r.records)).catch((e) => onError(String(e)));
  }, [scope, onError]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={cardStyle}>
        <p style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
          Mémoire persistante RÉELLEMENT lue par le planning (échecs connus jamais répétés, succès observés réutilisés — voir graphRunner.ts::planInitialGraph). Filtre mécanique par mots-clés, jamais une recherche sémantique fabriquée.
        </p>
        <label style={{ fontSize: 12, color: "var(--color-text-muted)", display: "block", marginTop: 10 }}>
          Filtrer par scope
          <select value={scope} onChange={(e) => setScope(e.target.value)} style={{ ...inputStyle, marginTop: 4, maxWidth: 260 }}>
            <option value="">Tous les scopes</option>
            {MEMORY_SCOPES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
      </div>
      <div style={{ display: "grid", gap: 6 }}>
        {records.map((r) => (
          <div key={r.id} style={{ ...cardStyle, padding: "var(--space-3)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <Badge tone={r.scope === "FAILURE" ? "err" : r.scope === "OUTCOME" ? "ok" : "info"}>{r.scope}</Badge>
              <span style={{ fontSize: 11, color: "var(--color-text-faint)" }}>{new Date(r.createdAt).toLocaleString("fr-FR")}</span>
            </div>
            <p style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: 6 }}>{r.content}</p>
            <p style={{ fontSize: 10, color: "var(--color-text-faint)", marginTop: 4 }}>
              {r.sourceKind} · confiance {r.confidence} {r.missionId && `· mission ${r.missionId}`}
            </p>
          </div>
        ))}
        {records.length === 0 && <p style={{ color: "var(--color-text-faint)" }}>Aucun enregistrement pour ce filtre.</p>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// EXPERIMENTS — Experiment Mode réel (§51-53) : A/B/... sur objectif réel,
// jugé par un juge indépendant, jamais un gagnant simulé.
// ---------------------------------------------------------------------------
interface ExperimentVariantView {
  id: string;
  label: string;
  provider: string | null;
  model: string | null;
  promptVariant: string | null;
  outputText: string | null;
  costUsd: number | null;
  latencyMs: number | null;
  score: number | null;
  scoreReason: string | null;
}
interface ExperimentSummaryView {
  id: string;
  objective: string;
  dimension: string;
  status: string;
  winnerVariantId: string | null;
  createdAt: string;
  finishedAt: string | null;
  variants: ExperimentVariantView[];
}
interface VariantFormRow {
  label: string;
  provider: "" | "anthropic" | "openai";
  model: string;
  promptVariant: string;
}

function newVariantRow(label: string): VariantFormRow {
  return { label, provider: "", model: "", promptVariant: "" };
}

function ExperimentsTab({ onError }: { onError: (e: string) => void }) {
  const [experiments, setExperiments] = useState<ExperimentSummaryView[]>([]);
  const [selected, setSelected] = useState<ExperimentSummaryView | null>(null);
  const [objective, setObjective] = useState("");
  const [dimension, setDimension] = useState<"MODEL" | "PROMPT" | "STRATEGY" | "AGENT">("MODEL");
  const [rows, setRows] = useState<VariantFormRow[]>([newVariantRow("A"), newVariantRow("B")]);
  const [launching, setLaunching] = useState(false);

  const refresh = useCallback(() => {
    callWithStepUp<{ experiments: ExperimentSummaryView[] }>("/api/ai-lab/experiments")
      .then((r) => setExperiments(r.experiments))
      .catch((e) => onError(String(e)));
  }, [onError]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  function updateRow(i: number, patch: Partial<VariantFormRow>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function addRow() {
    const nextLabel = String.fromCharCode(65 + rows.length); // A, B, C, ...
    setRows((prev) => [...prev, newVariantRow(nextLabel)]);
  }
  function removeRow(i: number) {
    if (rows.length <= 2) return; // §51 : au moins 2 variantes, jamais un A/B à un seul bras
    setRows((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function launch() {
    setLaunching(true);
    try {
      const variants = rows.map((r) => ({
        label: r.label,
        provider: r.provider || undefined,
        model: r.model.trim() || undefined,
        promptVariant: r.promptVariant.trim() || undefined,
      }));
      const created = await callWithStepUp<{ experiment: ExperimentSummaryView }>("/api/ai-lab/experiments", {
        method: "POST",
        body: JSON.stringify({ objective, dimension, variants }),
      });
      setSelected(created.experiment);
      refresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setLaunching(false);
    }
  }

  async function open(id: string) {
    try {
      const r = await callWithStepUp<{ experiment: ExperimentSummaryView }>(`/api/ai-lab/experiments/${id}`);
      setSelected(r.experiment);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div style={{ display: "grid", gap: "var(--space-5)" }}>
      <div style={cardStyle}>
        <h2 style={{ margin: 0, fontSize: 15 }}>Nouvel Experiment</h2>
        <p style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: 4 }}>
          Compare au moins 2 configurations réelles sur LE MÊME objectif — chaque variante fait un vrai appel modèle, un juge indépendant note chaque sortie 0-100 (jamais un gagnant simulé, jamais un variant qui s&apos;auto-évalue).
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 200px", gap: 10, marginTop: 12 }}>
          <label style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
            Objectif (identique pour toutes les variantes)
            <textarea value={objective} onChange={(e) => setObjective(e.target.value)} rows={3} placeholder='Ex. "Rédige une description produit pour ce t-shirt, en français, orientée conversion."' style={{ ...inputStyle, marginTop: 4, resize: "vertical" }} />
          </label>
          <label style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
            Dimension comparée
            <select value={dimension} onChange={(e) => setDimension(e.target.value as typeof dimension)} style={{ ...inputStyle, marginTop: 4 }}>
              <option value="MODEL">MODEL (provider/modèle)</option>
              <option value="PROMPT">PROMPT (instruction)</option>
              <option value="STRATEGY">STRATEGY</option>
              <option value="AGENT">AGENT</option>
            </select>
          </label>
        </div>

        <div style={{ marginTop: 14, display: "grid", gap: 8 }}>
          {rows.map((r, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "60px 140px 1fr 1fr 32px", gap: 8, alignItems: "start" }}>
              <input value={r.label} onChange={(e) => updateRow(i, { label: e.target.value })} style={inputStyle} placeholder="Label" />
              <select value={r.provider} onChange={(e) => updateRow(i, { provider: e.target.value as VariantFormRow["provider"] })} style={inputStyle}>
                <option value="">(défaut système)</option>
                <option value="anthropic">anthropic</option>
                <option value="openai">openai</option>
              </select>
              <input value={r.model} onChange={(e) => updateRow(i, { model: e.target.value })} placeholder="Modèle (optionnel, sinon défaut)" style={inputStyle} />
              <input value={r.promptVariant} onChange={(e) => updateRow(i, { promptVariant: e.target.value })} placeholder="Consigne de variante (PROMPT/STRATEGY)" style={inputStyle} />
              <button disabled={rows.length <= 2} onClick={() => removeRow(i)} style={{ ...secondaryButtonStyle, padding: "6px 8px" }} title="Retirer cette variante">✕</button>
            </div>
          ))}
          <button style={{ ...secondaryButtonStyle, width: "fit-content" }} onClick={addRow}>+ Ajouter une variante</button>
        </div>

        <button disabled={launching || !objective.trim() || rows.some((r) => !r.label.trim())} style={{ ...buttonStyle, marginTop: 14 }} onClick={launch}>
          {launching ? "Exécution réelle en cours…" : "Lancer l'Experiment"}
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: "var(--space-5)" }}>
        <div style={cardStyle}>
          <h3 style={{ margin: 0, fontSize: 14 }}>Historique ({experiments.length})</h3>
          <div style={{ marginTop: 10, display: "grid", gap: 6, maxHeight: 500, overflowY: "auto" }}>
            {experiments.map((e) => (
              <button
                key={e.id}
                onClick={() => open(e.id)}
                style={{ textAlign: "left", background: selected?.id === e.id ? "var(--color-surface-alt)" : "transparent", border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)", padding: 8, cursor: "pointer", color: "var(--color-text)" }}
              >
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.objective}</div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <Badge tone={healthTone(e.status)}>{e.status}</Badge>
                  <span style={{ fontSize: 11, color: "var(--color-text-faint)" }}>{e.dimension} · {e.variants.length} variantes</span>
                </div>
              </button>
            ))}
            {experiments.length === 0 && <p style={{ fontSize: 12, color: "var(--color-text-faint)" }}>Aucun Experiment encore.</p>}
          </div>
        </div>

        <div style={cardStyle}>
          {!selected && <p style={{ color: "var(--color-text-faint)" }}>Sélectionnez un Experiment pour voir les variantes notées.</p>}
          {selected && (
            <div>
              <h3 style={{ margin: 0, fontSize: 15 }}>{selected.objective}</h3>
              <div style={{ marginTop: 6, display: "flex", gap: 8, alignItems: "center" }}>
                <Badge tone={healthTone(selected.status)}>{selected.status}</Badge>
                <span style={{ fontSize: 12, color: "var(--color-text-faint)" }}>{selected.dimension}</span>
              </div>
              <div style={{ marginTop: 14, display: "grid", gap: 8 }}>
                {selected.variants
                  .slice()
                  .sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
                  .map((v) => (
                    <div key={v.id} style={{ border: v.id === selected.winnerVariantId ? "2px solid var(--color-success)" : "1px solid var(--color-border)", borderRadius: "var(--radius-sm)", padding: 10 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <strong style={{ fontSize: 13 }}>
                          Variante {v.label} {v.id === selected.winnerVariantId && <Badge tone="ok">GAGNANT</Badge>}
                        </strong>
                        <span style={{ fontSize: 12, color: "var(--color-text-faint)" }}>
                          {v.provider ?? "—"}/{v.model ?? "—"} {v.latencyMs != null && `· ${(v.latencyMs / 1000).toFixed(1)}s`} {v.costUsd != null && `· ${v.costUsd.toFixed(4)} USD`}
                        </span>
                      </div>
                      {v.score != null && (
                        <p style={{ fontSize: 13, fontWeight: 700, marginTop: 6, color: v.score >= 70 ? "var(--color-success)" : v.score >= 40 ? "var(--color-warning)" : "var(--color-danger)" }}>
                          Score : {v.score}/100
                        </p>
                      )}
                      {v.scoreReason && <p style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: 4 }}>{v.scoreReason}</p>}
                      {v.outputText && (
                        <details style={{ marginTop: 6 }}>
                          <summary style={{ fontSize: 11, cursor: "pointer", color: "var(--color-text-faint)" }}>Voir la sortie complète</summary>
                          <p style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: 6, whiteSpace: "pre-wrap" }}>{v.outputText}</p>
                        </details>
                      )}
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// EVOLUTION — System Evolution Console réel (§61-65) : hypothèse → VRAIE
// CoderMission → revue Owner → livraison réelle en Pull Request GitHub.
// ---------------------------------------------------------------------------
interface EvolutionProposalView {
  id: string;
  source: string;
  hypothesis: string;
  targetArea: string;
  status: string;
  coderMissionId: string | null;
  coderMission: { id: string; status: string; lastError: string | null } | null;
  reviewNote: string | null;
  shippedPrUrl: string | null;
  shippedBranch: string | null;
  createdAt: string;
}

function EvolutionTab({ onError }: { onError: (e: string) => void }) {
  const [proposals, setProposals] = useState<EvolutionProposalView[]>([]);
  const [selected, setSelected] = useState<EvolutionProposalView | null>(null);
  const [hypothesis, setHypothesis] = useState("");
  const [targetArea, setTargetArea] = useState("");
  const [busy, setBusy] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [reviewNote, setReviewNote] = useState("");

  const refresh = useCallback(() => {
    callWithStepUp<{ proposals: EvolutionProposalView[] }>("/api/ai-lab/evolution/proposals")
      .then((r) => setProposals(r.proposals))
      .catch((e) => onError(String(e)));
  }, [onError]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function open(id: string) {
    try {
      const r = await callWithStepUp<{ proposal: EvolutionProposalView }>(`/api/ai-lab/evolution/proposals/${id}`);
      setSelected(r.proposal);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  }

  async function detectSignals() {
    setDetecting(true);
    try {
      const r = await callWithStepUp<{ created: number; skippedExisting: number }>("/api/ai-lab/evolution/detect", { method: "POST" });
      onError(`Scan de signaux terminé : ${r.created} nouvelle(s) proposition(s), ${r.skippedExisting} déjà couverte(s).`);
      refresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setDetecting(false);
    }
  }

  async function createProposal() {
    setBusy(true);
    try {
      await callWithStepUp("/api/ai-lab/evolution/proposals", { method: "POST", body: JSON.stringify({ hypothesis, targetArea }) });
      setHypothesis("");
      setTargetArea("");
      refresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function launch(id: string) {
    setBusy(true);
    try {
      await callWithStepUp(`/api/ai-lab/evolution/proposals/${id}/launch`, { method: "POST" });
      await open(id);
      refresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function review(id: string, decision: "APPROVE" | "REJECT") {
    setBusy(true);
    try {
      await callWithStepUp(`/api/ai-lab/evolution/proposals/${id}/review`, { method: "POST", body: JSON.stringify({ decision, note: reviewNote || undefined }) });
      setReviewNote("");
      await open(id);
      refresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function ship(id: string) {
    if (typeof window !== "undefined" && !window.confirm("Ouvrir réellement une Pull Request sur le dépôt GitHub connecté avec les changements de cette mission ? Cette action écrit sur un système externe.")) return;
    setBusy(true);
    try {
      const r = await callWithStepUp<{ ship: { prUrl: string } }>(`/api/ai-lab/evolution/proposals/${id}/ship`, { method: "POST" });
      onError(`Pull Request ouverte : ${r.ship.prUrl}`);
      await open(id);
      refresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: "var(--space-5)" }}>
      <div style={cardStyle}>
        <h2 style={{ margin: 0, fontSize: 15 }}>System Evolution Console</h2>
        <p style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: 4 }}>
          Pipeline réel : hypothèse (détectée mécaniquement depuis l&apos;Agent Registry, ou écrite par vous) → VRAIE CoderMission (édite, compile, teste, construit) → votre revue du résultat réel → livraison en Pull Request GitHub uniquement après votre approbation explicite. Aucune étape n&apos;est franchie par l&apos;IA elle-même.
        </p>
        <button disabled={detecting} style={{ ...secondaryButtonStyle, marginTop: 10 }} onClick={detectSignals}>
          {detecting ? "Analyse…" : "Analyser les signaux (Agent Registry)"}
        </button>

        <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "1fr 200px 140px", gap: 8, alignItems: "start" }}>
          <textarea value={hypothesis} onChange={(e) => setHypothesis(e.target.value)} rows={2} placeholder='Hypothèse — ex. "Le rôle researcher échoue souvent faute de web search activé, ajouter une vérification explicite en amont."' style={{ ...inputStyle, resize: "vertical" }} />
          <input value={targetArea} onChange={(e) => setTargetArea(e.target.value)} placeholder="Zone ciblée (ex. supervisor)" style={inputStyle} />
          <button disabled={busy || !hypothesis.trim() || !targetArea.trim()} style={buttonStyle} onClick={createProposal}>
            Proposer
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: "var(--space-5)" }}>
        <div style={cardStyle}>
          <h3 style={{ margin: 0, fontSize: 14 }}>Propositions ({proposals.length})</h3>
          <div style={{ marginTop: 10, display: "grid", gap: 6, maxHeight: 560, overflowY: "auto" }}>
            {proposals.map((p) => (
              <button
                key={p.id}
                onClick={() => open(p.id)}
                style={{ textAlign: "left", background: selected?.id === p.id ? "var(--color-surface-alt)" : "transparent", border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)", padding: 8, cursor: "pointer", color: "var(--color-text)" }}
              >
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.targetArea}</div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <Badge tone={healthTone(p.status)}>{p.status}</Badge>
                  <span style={{ fontSize: 11, color: "var(--color-text-faint)" }}>{p.source === "SYSTEM_ANALYSIS" ? "détecté" : "Owner"}</span>
                </div>
              </button>
            ))}
            {proposals.length === 0 && <p style={{ fontSize: 12, color: "var(--color-text-faint)" }}>Aucune proposition encore.</p>}
          </div>
        </div>

        <div style={cardStyle}>
          {!selected && <p style={{ color: "var(--color-text-faint)" }}>Sélectionnez une proposition.</p>}
          {selected && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: 15 }}>{selected.targetArea}</h3>
                  <div style={{ marginTop: 6, display: "flex", gap: 8, alignItems: "center" }}>
                    <Badge tone={healthTone(selected.status)}>{selected.status}</Badge>
                    <span style={{ fontSize: 12, color: "var(--color-text-faint)" }}>{selected.source === "SYSTEM_ANALYSIS" ? "Détecté mécaniquement" : "Écrit par l'Owner"}</span>
                  </div>
                </div>
                {selected.status === "PROPOSED" && (
                  <button disabled={busy} style={buttonStyle} onClick={() => launch(selected.id)}>
                    Lancer la CoderMission
                  </button>
                )}
              </div>

              <p style={{ fontSize: 13, color: "var(--color-text-muted)", marginTop: 12, whiteSpace: "pre-wrap" }}>{selected.hypothesis}</p>

              {selected.coderMission && (
                <div style={{ marginTop: 12, padding: 10, border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)" }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <strong style={{ fontSize: 12 }}>CoderMission {selected.coderMission.id}</strong>
                    <Badge tone={healthTone(selected.coderMission.status)}>{selected.coderMission.status}</Badge>
                  </div>
                  {selected.coderMission.lastError && <p style={{ fontSize: 12, color: "var(--color-danger)", marginTop: 6 }}>{selected.coderMission.lastError}</p>}
                  {["QUEUED", "RUNNING"].includes(selected.coderMission.status) && (
                    <p style={{ fontSize: 11, color: "var(--color-text-faint)", marginTop: 6 }}>
                      Exécutez <code>tsx scripts/run-coder-mission.ts --mission {selected.coderMission.id} --repo . --path / --page-description &quot;…&quot;</code> depuis un environnement de développement, ou déclenchez le workflow GitHub Actions <code>coder-mission.yml</code> (onglet Actions du dépôt) — l&apos;exécution réelle (checkout git, Chromium) reste hors Vercel.
                    </p>
                  )}
                </div>
              )}

              {selected.status === "AWAITING_OWNER_REVIEW" && (
                <div style={{ marginTop: 12, padding: 10, border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)" }}>
                  <label style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
                    Note de revue (optionnelle)
                    <textarea value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} rows={2} style={{ ...inputStyle, marginTop: 4, resize: "vertical" }} />
                  </label>
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <button disabled={busy || selected.coderMission?.status !== "SUCCEEDED"} style={buttonStyle} onClick={() => review(selected.id, "APPROVE")} title={selected.coderMission?.status !== "SUCCEEDED" ? "Approbation impossible : la mission n'a pas réussi" : undefined}>
                      Approuver
                    </button>
                    <button disabled={busy} style={{ ...secondaryButtonStyle, color: "var(--color-danger)" }} onClick={() => review(selected.id, "REJECT")}>
                      Rejeter
                    </button>
                  </div>
                </div>
              )}

              {selected.status === "APPROVED" && (
                <div style={{ marginTop: 12 }}>
                  <button disabled={busy} style={buttonStyle} onClick={() => ship(selected.id)}>
                    Livrer réellement (ouvrir la Pull Request GitHub)
                  </button>
                </div>
              )}

              {selected.status === "SHIPPED" && selected.shippedPrUrl && (
                <p style={{ fontSize: 13, color: "var(--color-success)", marginTop: 12 }}>
                  Livré — Pull Request réelle :{" "}
                  <a href={selected.shippedPrUrl} target="_blank" rel="noreferrer" style={{ color: "inherit" }}>
                    {selected.shippedPrUrl}
                  </a>{" "}
                  (branche {selected.shippedBranch})
                </p>
              )}

              {selected.reviewNote && <p style={{ fontSize: 12, color: "var(--color-text-faint)", marginTop: 10 }}>Note de revue : {selected.reviewNote}</p>}
            </div>
          )}
        </div>
      </div>
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

      <OwnerSessionsPanel onError={onError} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// OWNER SESSIONS — §"DELIVERY CONDITION — OWNER IDENTITY" (revocation réelle)
// ---------------------------------------------------------------------------
interface OwnerSessionRow {
  id: string;
  assuranceLevel: string;
  createdAt: string;
  lastSeenAt: string;
  userAgent: string | null;
  revokedAt: string | null;
  isCurrent: boolean;
}

function OwnerSessionsPanel({ onError }: { onError: (e: string) => void }) {
  const [sessions, setSessions] = useState<OwnerSessionRow[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(() => {
    callWithStepUp<{ sessions: OwnerSessionRow[] }>("/api/owner/sessions").then((r) => setSessions(r.sessions)).catch((e) => onError(String(e)));
  }, [onError]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function revoke(id: string) {
    setBusyId(id);
    try {
      await callWithStepUp(`/api/owner/sessions/${id}/revoke`, { method: "POST" });
      refresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div style={cardStyle}>
      <h3 style={{ margin: 0, fontSize: 14 }}>Sessions Owner (WebAuthn) — révocation réelle</h3>
      <p style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: 4 }}>
        Table dédiée (PlatformOwnerSession), séparée de la session applicative normale — la révocation ici prend effet IMMÉDIATEMENT sur toute route Control Plane protégée.
      </p>
      <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
        {sessions.map((s) => (
          <div key={s.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid var(--color-border)", fontSize: 12 }}>
            <div>
              <Badge tone={s.revokedAt ? "off" : s.assuranceLevel === "L3_STEP_UP" ? "ok" : "info"}>{s.revokedAt ? "REVOKED" : s.assuranceLevel}</Badge>
              <span style={{ marginLeft: 8, color: "var(--color-text-muted)" }}>
                Dernière activité {new Date(s.lastSeenAt).toLocaleString("fr-FR")} — {s.userAgent ?? "agent inconnu"}
              </span>
              {s.isCurrent && <span style={{ marginLeft: 8, color: "var(--color-text-faint)" }}>(session actuelle)</span>}
            </div>
            {!s.revokedAt && (
              <button disabled={busyId === s.id} style={{ ...secondaryButtonStyle, color: "var(--color-danger)" }} onClick={() => revoke(s.id)}>
                Révoquer
              </button>
            )}
          </div>
        ))}
        {sessions.length === 0 && <p style={{ color: "var(--color-text-faint)" }}>Aucune session active.</p>}
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
