/**
 * ONDEAL AI CORE — PHASE 5 (suite) : connecteur Windsor.ai RÉEL (06/09/2026),
 * §"Connecteurs restants" (mandat AI LAB ULTIMATE — CONNECTOR HUB).
 *
 * Jusqu'ici "windsor_ai" (Connector Registry, connectors/registry.ts) était
 * honnêtement toujours NOT_CONFIGURED — architecture-only, aucun client API
 * réel écrit. Ce fichier est ce client réel : Windsor.ai REST API
 * (connectors.windsor.ai), UNE variable d'environnement plateforme
 * (WINDSOR_API_KEY, déjà documentée par `requiredSecrets`) — même principe
 * que KLAVIYO_API_KEY/OPENAI_API_KEY : un seul compte Windsor.ai par
 * déploiement OnDeal, jamais un identifiant par boutique.
 *
 * Contrat d'API vérifié par recherche RÉELLE le 06/09/2026 (§57 "ne jamais
 * se fier à la mémoire d'entraînement pour un détail d'API en production") :
 * endpoint `GET https://connectors.windsor.ai/{connector}` avec les
 * paramètres `api_key`, `fields` (liste séparée par virgules) et
 * `date_preset` (ex. "last_7d") ; réponse JSON `{ "data": [ {...champs
 * demandés...} ] }` — à REVÉRIFIER contre windsor.ai/api-documentation
 * avant tout usage réel à volume (le contrat peut évoluer).
 *
 * §"NO FAKE CONNECTOR" : AUCUNE lecture n'affiche une métrique publicitaire
 * sans un appel RÉEL à connectors.windsor.ai avec la clé configurée — jamais
 * une donnée simulée.
 */

const WINDSOR_API = "https://connectors.windsor.ai";

export class WindsorConnectorError extends Error {}

function requireApiKey(): string {
  const apiKey = process.env.WINDSOR_API_KEY;
  if (!apiKey) throw new WindsorConnectorError("WINDSOR_API_KEY absent — connecteur Windsor.ai non configuré (READY_FOR_OWNER_AUTHORIZATION, voir rapport de session).");
  return apiKey;
}

async function windsorFetch(connector: string, fields: string[], datePreset: string): Promise<Response> {
  const apiKey = requireApiKey();
  const url = `${WINDSOR_API}/${encodeURIComponent(connector)}?api_key=${encodeURIComponent(apiKey)}&fields=${encodeURIComponent(fields.join(","))}&date_preset=${encodeURIComponent(datePreset)}`;
  return fetch(url);
}

export interface WindsorConnectorHealth {
  status: "AVAILABLE" | "DISABLED" | "ERROR" | "RATE_LIMITED";
  detail: string;
}

/** Health check RÉEL — un appel léger (1 champ, "all", fenêtre 7 jours) plutôt qu'un appel large, jamais une déduction de la présence de la clé seule. */
export async function windsorHealthCheck(): Promise<WindsorConnectorHealth> {
  if (!process.env.WINDSOR_API_KEY) return { status: "DISABLED", detail: "WINDSOR_API_KEY non configurée — connecteur prêt, en attente d'autorisation Owner." };
  try {
    const res = await windsorFetch("all", ["date"], "last_7d");
    if (res.status === 429) return { status: "RATE_LIMITED", detail: "Limite de débit Windsor.ai atteinte." };
    if (!res.ok) return { status: "ERROR", detail: `L'API Windsor.ai a répondu ${res.status}.` };
    return { status: "AVAILABLE", detail: "Connexion réelle vérifiée à l'instant." };
  } catch (err) {
    return { status: "ERROR", detail: err instanceof Error ? err.message : "Erreur réseau." };
  }
}

export interface WindsorSpendRow {
  date: string | null;
  source: string | null;
  spend: number | null;
  impressions: number | null;
  clicks: number | null;
}

interface WindsorApiResponse {
  data?: Array<Record<string, unknown>>;
}

/**
 * Lecture RÉELLE des dépenses publicitaires cross-canal — capability
 * "cross_channel_analytics" déclarée par le Connector Registry. `connector`
 * par défaut "all" (agrège toutes les plateformes connectées côté compte
 * Windsor.ai de l'Owner) — jamais un canal inventé si l'appelant n'en
 * précise pas.
 */
export async function getCrossChannelSpend(opts?: { connector?: string; datePreset?: string }): Promise<WindsorSpendRow[]> {
  const connector = opts?.connector ?? "all";
  const datePreset = opts?.datePreset ?? "last_30d";
  const fields = ["date", "source", "spend", "impressions", "clicks"];
  const res = await windsorFetch(connector, fields, datePreset);
  if (!res.ok) throw new WindsorConnectorError(`Lecture des données Windsor.ai échouée (${res.status}).`);
  const body = (await res.json()) as WindsorApiResponse;
  return (body.data ?? []).map((row) => ({
    date: typeof row.date === "string" ? row.date : null,
    source: typeof row.source === "string" ? row.source : null,
    spend: typeof row.spend === "number" ? row.spend : null,
    impressions: typeof row.impressions === "number" ? row.impressions : null,
    clicks: typeof row.clicks === "number" ? row.clicks : null,
  }));
}
