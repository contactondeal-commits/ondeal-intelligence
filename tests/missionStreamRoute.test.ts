import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * ONDEAL AI CORE — §12 "SSE temps réel pour la progression de mission"
 * (06/09/2026), clôture réelle.
 *
 * Verrouille GET /api/ai-lab/missions/[id]/stream :
 *   - 403 si la capacité Control Plane est refusée — jamais un flux ouvert
 *     sans vérification.
 *   - Un événement "error" (jamais un flux qui reste ouvert en silence)
 *     quand la mission est introuvable.
 *   - Un statut TERMINAL (SUCCEEDED/FAILED/CANCELLED) émet le payload puis
 *     ferme le flux immédiatement — jamais un flux qui traîne sur une
 *     mission déjà terminée.
 *   - Deux lectures IDENTIQUES consécutives ne produisent qu'UN SEUL
 *     événement "mission" — jamais un événement dupliqué juste pour "faire
 *     du temps réel" ; un VRAI changement produit un second événement.
 */

function makeRequest(id: string): NextRequest {
  return new NextRequest(`http://localhost/api/ai-lab/missions/${id}/stream`);
}

async function readAllSseEvents(res: Response): Promise<Array<{ event: string; data: unknown }>> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events: Array<{ event: string; data: unknown }> = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sepIndex: number;
    while ((sepIndex = buffer.indexOf("\n\n")) >= 0) {
      const raw = buffer.slice(0, sepIndex);
      buffer = buffer.slice(sepIndex + 2);
      const eventLine = raw.split("\n").find((l) => l.startsWith("event: "));
      const dataLine = raw.split("\n").find((l) => l.startsWith("data: "));
      if (eventLine && dataLine) {
        events.push({ event: eventLine.slice("event: ".length), data: JSON.parse(dataLine.slice("data: ".length)) });
      }
    }
  }
  return events;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.useRealTimers();
});

async function loadRoute(opts: {
  requireCapability?: ReturnType<typeof vi.fn>;
  buildMissionDetailPayload?: ReturnType<typeof vi.fn>;
}) {
  vi.resetModules();
  vi.doMock("@/lib/authz/capabilities", () => ({
    requireCapability: opts.requireCapability ?? vi.fn().mockResolvedValue({ userId: "owner1", email: "o@x.com" }),
    CapabilityError: class CapabilityError extends Error {},
  }));
  vi.doMock("@/lib/ai/supervisor/missionDetail", () => ({
    buildMissionDetailPayload: opts.buildMissionDetailPayload ?? vi.fn().mockResolvedValue(null),
    TERMINAL_MISSION_STATUSES: new Set(["SUCCEEDED", "FAILED", "CANCELLED"]),
  }));
  return import("@/app/api/ai-lab/missions/[id]/stream/route");
}

describe("GET /api/ai-lab/missions/[id]/stream", () => {
  it("répond 403 (jamais un flux ouvert) quand la capacité est refusée", async () => {
    vi.resetModules();
    class FakeCapabilityError extends Error {}
    vi.doMock("@/lib/authz/capabilities", () => ({
      requireCapability: vi.fn().mockRejectedValue(new FakeCapabilityError("Capacité refusée.")),
      CapabilityError: FakeCapabilityError,
    }));
    vi.doMock("@/lib/ai/supervisor/missionDetail", () => ({ buildMissionDetailPayload: vi.fn(), TERMINAL_MISSION_STATUSES: new Set() }));
    const { GET } = await import("@/app/api/ai-lab/missions/[id]/stream/route");

    const res = await GET(makeRequest("m1"), { params: Promise.resolve({ id: "m1" }) });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Capacité refusée.");
  });

  it("émet un événement \"error\" et ferme le flux quand la mission est introuvable", async () => {
    const buildMissionDetailPayload = vi.fn().mockResolvedValue(null);
    const { GET } = await loadRoute({ buildMissionDetailPayload });

    const res = await GET(makeRequest("missing"), { params: Promise.resolve({ id: "missing" }) });
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    const events = await readAllSseEvents(res);
    expect(events).toEqual([{ event: "error", data: { error: "Mission introuvable." } }]);
  });

  it("émet le payload puis ferme immédiatement le flux dès que le statut est TERMINAL — jamais un flux qui traîne", async () => {
    const buildMissionDetailPayload = vi.fn().mockResolvedValue({ mission: { id: "m1", status: "SUCCEEDED" }, nodes: [], artifacts: [], auditLogs: [], attachments: [] });
    const { GET } = await loadRoute({ buildMissionDetailPayload });

    const res = await GET(makeRequest("m1"), { params: Promise.resolve({ id: "m1" }) });
    const events = await readAllSseEvents(res);
    expect(events).toHaveLength(1);
    expect(events[0]?.event).toBe("mission");
    expect((events[0]?.data as { mission: { status: string } }).mission.status).toBe("SUCCEEDED");
    expect(buildMissionDetailPayload).toHaveBeenCalledTimes(1); // un seul appel — le statut terminal arrête la boucle avant tout second sondage
  });

  it("un VRAI changement entre deux sondages produit un second événement ; une lecture identique n'en produit aucun", async () => {
    vi.useFakeTimers();
    const runningPayload = { mission: { id: "m1", status: "RUNNING" }, nodes: [{ id: "n1", status: "RUNNING" }], artifacts: [], auditLogs: [], attachments: [] };
    const runningPayloadChanged = { mission: { id: "m1", status: "RUNNING" }, nodes: [{ id: "n1", status: "SUCCEEDED" }], artifacts: [], auditLogs: [], attachments: [] };
    const succeededPayload = { mission: { id: "m1", status: "SUCCEEDED" }, nodes: [{ id: "n1", status: "SUCCEEDED" }], artifacts: [], auditLogs: [], attachments: [] };
    const buildMissionDetailPayload = vi
      .fn()
      .mockResolvedValueOnce(runningPayload) // 1er sondage : RUNNING, node encore en cours → événement
      .mockResolvedValueOnce(runningPayload) // 2e sondage : RIEN n'a changé → pas de nouvel événement
      .mockResolvedValueOnce(runningPayloadChanged) // 3e sondage : le node a réellement changé → événement
      .mockResolvedValueOnce(succeededPayload); // 4e sondage : mission terminale → événement puis fermeture

    const { GET } = await loadRoute({ buildMissionDetailPayload });
    const res = await GET(makeRequest("m1"), { params: Promise.resolve({ id: "m1" }) });

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const events: Array<{ event: string; data: unknown }> = [];

    // Un ReadableStreamDefaultReader ne résout ses read() qu'en FIFO : si un
    // appel précédent a "perdu" la course contre le timeout, il reste en
    // attente dans la file interne du reader. Émettre un NOUVEL appel
    // read() par itération le mettrait derrière l'ancien, qui absorberait
    // silencieusement le PROCHAIN chunk réel (jamais lu par le test).
    // Un seul appel read() en vol à la fois, réutilisé tant qu'il n'a pas
    // réellement abouti.
    let pendingRead: Promise<ReadableStreamReadResult<Uint8Array>> | null = null;

    async function drainAvailable() {
      for (;;) {
        if (!pendingRead) pendingRead = reader.read();
        type RaceOutcome = { kind: "read"; r: ReadableStreamReadResult<Uint8Array> } | { kind: "timeout" };
        const racePromise: Promise<RaceOutcome> = Promise.race([
          pendingRead.then((r): RaceOutcome => ({ kind: "read", r })),
          new Promise<RaceOutcome>((resolve) => setTimeout(() => resolve({ kind: "timeout" }), 0)),
        ]);
        await vi.advanceTimersByTimeAsync(0);
        const outcome = await racePromise;
        if (outcome.kind === "timeout") break;
        pendingRead = null; // ce read() a réellement abouti — le prochain tour en émettra un nouveau
        const { value, done } = outcome.r;
        if (done) return true;
        buffer += decoder.decode(value, { stream: true });
        let sepIndex: number;
        while ((sepIndex = buffer.indexOf("\n\n")) >= 0) {
          const raw = buffer.slice(0, sepIndex);
          buffer = buffer.slice(sepIndex + 2);
          const eventLine = raw.split("\n").find((l) => l.startsWith("event: "));
          const dataLine = raw.split("\n").find((l) => l.startsWith("data: "));
          if (eventLine && dataLine) events.push({ event: eventLine.slice("event: ".length), data: JSON.parse(dataLine.slice("data: ".length)) });
        }
      }
      return false;
    }

    // 1er événement disponible immédiatement (premier sondage, jamais de délai avant le tout premier).
    await drainAvailable();
    // Avance le minuteur interne (POLL_INTERVAL_MS=1500) pour chaque sondage suivant.
    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(1500);
      await drainAvailable();
    }

    expect(buildMissionDetailPayload).toHaveBeenCalledTimes(4);
    expect(events.map((e) => e.event)).toEqual(["mission", "mission", "mission"]); // 1er, 3e (changé), 4e (terminal) — jamais le 2e (identique)
    expect((events[1]?.data as { nodes: Array<{ status: string }> }).nodes[0]?.status).toBe("SUCCEEDED");
    expect((events[2]?.data as { mission: { status: string } }).mission.status).toBe("SUCCEEDED");
  }, 15000);
});
