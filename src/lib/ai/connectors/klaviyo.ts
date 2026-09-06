/**
 * ONDEAL AI CORE — PHASE 5 (suite) : connecteur Klaviyo RÉEL (06/09/2026),
 * §"Connecteurs restants" (mandat AI LAB ULTIMATE — CONNECTOR HUB).
 *
 * Jusqu'ici "klaviyo" (Connector Registry, connectors/registry.ts) était
 * honnêtement toujours NOT_CONFIGURED — architecture-only, aucun client API
 * réel écrit. Ce fichier est ce client réel : Klaviyo REST API, clé privée
 * de compte (API_KEY, comme déjà documenté par `requiredSecrets:
 * ["KLAVIYO_API_KEY"]`) — UNE variable d'environnement plateforme, jamais
 * un identifiant par boutique (contrairement à Shopify/GA4/Judge.me/CJ
 * Dropshipping, qui sont scopés par storeId via la table Integration) : un
 * compte Klaviyo par déploiement OnDeal, même principe que OPENAI_API_KEY.
 *
 * §"NO FAKE CONNECTOR" : AUCUNE lecture n'affiche une campagne sans un appel
 * RÉEL à a.klaviyo.com avec la clé configurée — jamais une donnée simulée.
 *
 * Révision d'API Klaviyo (header `revision`, format date) : à REVÉRIFIER
 * contre developers.klaviyo.com avant tout usage réel à volume — même règle
 * §57 déjà appliquée aux tarifs OpenAI/Anthropic dans ce dépôt : ne jamais se
 * fier à la mémoire d'entraînement pour un détail d'API versionnée en
 * production.
 */

const KLAVIYO_API = "https://a.klaviyo.com/api";
const KLAVIYO_REVISION = "2024-10-15";

export class KlaviyoConnectorError extends Error {}

function requireApiKey(): string {
  const apiKey = process.env.KLAVIYO_API_KEY;
  if (!apiKey) throw new KlaviyoConnectorError("KLAVIYO_API_KEY absent — connecteur Klaviyo non configuré (READY_FOR_OWNER_AUTHORIZATION, voir rapport de session).");
  return apiKey;
}

async function klaviyoFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const apiKey = requireApiKey();
  return fetch(`${KLAVIYO_API}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Klaviyo-API-Key ${apiKey}`,
      accept: "application/vnd.api+json",
      revision: KLAVIYO_REVISION,
    },
  });
}

export interface KlaviyoConnectorHealth {
  status: "AVAILABLE" | "DISABLED" | "ERROR" | "RATE_LIMITED";
  detail: string;
}

/** Health check RÉEL (même convention que openAiHealthCheck/githubHealthCheck) — un appel léger (GET /accounts/), jamais une déduction de la présence de la clé seule. */
export async function klaviyoHealthCheck(): Promise<KlaviyoConnectorHealth> {
  if (!process.env.KLAVIYO_API_KEY) return { status: "DISABLED", detail: "KLAVIYO_API_KEY non configurée — connecteur prêt, en attente d'autorisation Owner." };
  try {
    const res = await klaviyoFetch("/accounts/");
    if (res.status === 429) return { status: "RATE_LIMITED", detail: "Limite de débit Klaviyo atteinte." };
    if (!res.ok) return { status: "ERROR", detail: `L'API Klaviyo a répondu ${res.status}.` };
    return { status: "AVAILABLE", detail: "Connexion réelle vérifiée à l'instant (GET /accounts/)." };
  } catch (err) {
    return { status: "ERROR", detail: err instanceof Error ? err.message : "Erreur réseau." };
  }
}

export interface KlaviyoCampaignSummary {
  id: string;
  name: string | null;
  status: string | null;
  channel: string | null;
  sentAt: string | null;
}

interface KlaviyoCampaignResource {
  id: string;
  attributes?: { name?: string; status?: string; send_time?: string };
}
interface KlaviyoCampaignsResponse {
  data?: KlaviyoCampaignResource[];
}

/**
 * Lecture RÉELLE des campagnes email — capability "campaigns_read" déclarée
 * par le Connector Registry. Klaviyo exige un filtre de canal explicite sur
 * cet endpoint (contrat de leur API, pas une restriction OnDeal) — "email"
 * ici, jamais un filtre plus large silencieusement élargi.
 */
export async function listCampaigns(limit = 20): Promise<KlaviyoCampaignSummary[]> {
  const pageSize = Math.min(Math.max(limit, 1), 50);
  const res = await klaviyoFetch(`/campaigns?filter=equals(messages.channel,'email')&page[size]=${pageSize}`);
  if (!res.ok) throw new KlaviyoConnectorError(`Lecture des campagnes Klaviyo échouée (${res.status}).`);
  const body = (await res.json()) as KlaviyoCampaignsResponse;
  return (body.data ?? []).map((c) => ({
    id: c.id,
    name: c.attributes?.name ?? null,
    status: c.attributes?.status ?? null,
    channel: "email",
    sentAt: c.attributes?.send_time ?? null,
  }));
}
