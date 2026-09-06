import { NextRequest } from "next/server";
import { CapabilityError, requireCapability } from "@/lib/authz/capabilities";
import { buildMissionDetailPayload, TERMINAL_MISSION_STATUSES } from "@/lib/ai/supervisor/missionDetail";

/**
 * ONDEAL AI CORE — §12 "SSE temps réel pour la progression de mission"
 * (06/09/2026), clôture réelle.
 *
 * Remplace le polling client fixe à 5s (jusqu'ici la seule mise à jour de la
 * mission actuellement ouverte : elle n'était RAFRAÎCHIE QUE sur une action
 * manuelle — Reprendre/Annuler/ouvrir — jamais en continu) par un VRAI flux
 * Server-Sent Events : le serveur relit la mission en base toutes les
 * `POLL_INTERVAL_MS` et n'émet un événement QUE si le payload a réellement
 * changé (jamais un événement vide juste pour "faire du temps réel").
 *
 * FRONTIÈRE HONNÊTE (même principe que missions/[id]/run) : une fonction
 * Vercel a une durée d'exécution bornée. `maxDuration` la déclare
 * explicitement (60s, plan Hobby/Pro par défaut) ; ce flux s'arrête
 * proprement `HARD_DURATION_MS` avant cette limite plutôt que de risquer une
 * coupure brutale à mi-événement. `EventSource` côté navigateur SE
 * RECONNECTE NATIVEMENT après une fermeture propre du flux (comportement
 * standard de la spec SSE, pas un bug) — donc une mission longue reste
 * suivie en continu via une SUITE de connexions successives, jamais un flux
 * unique supposé tenir indéfiniment.
 */
export const maxDuration = 60;

const POLL_INTERVAL_MS = 1500;
const HARD_DURATION_MS = 55_000; // marge de sécurité sous maxDuration=60s — §"NO BLIND LOOP" appliqué à un flux, pas seulement une boucle de mission

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await requireCapability("SYSTEM_CODER");
  } catch (err) {
    if (err instanceof CapabilityError) {
      return new Response(JSON.stringify({ error: err.message }), { status: 403, headers: { "content-type": "application/json" } });
    }
    throw err;
  }

  const encoder = new TextEncoder();
  let cancelled = false;

  const stream = new ReadableStream({
    async start(controller) {
      const startedAt = Date.now();
      let lastSerialized: string | null = null;

      function send(event: string, data: unknown) {
        if (cancelled) return;
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      }

      while (!cancelled) {
        let payload;
        try {
          payload = await buildMissionDetailPayload(id);
        } catch (err) {
          send("error", { error: err instanceof Error ? err.message : String(err) });
          break;
        }
        if (!payload) {
          send("error", { error: "Mission introuvable." });
          break;
        }

        const serialized = JSON.stringify(payload);
        if (serialized !== lastSerialized) {
          send("mission", payload);
          lastSerialized = serialized;
        }

        if (TERMINAL_MISSION_STATUSES.has(payload.mission.status)) break; // plus rien ne changera jamais — fermeture propre, jamais un flux qui traîne sur une mission terminée
        if (Date.now() - startedAt > HARD_DURATION_MS) break; // reconnexion transparente côté navigateur, voir en-tête

        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
      if (!cancelled) controller.close();
    },
    cancel() {
      // Le navigateur a fermé la connexion (onglet fermé, mission désélectionnée côté client) — arrête la boucle au prochain tick, jamais un polling DB qui continue pour personne.
      cancelled = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
