import type { GenerateRequest, GenerateResult, ModelCapabilities, ModelProvider } from "@/lib/ai/providers/provider";

/**
 * ONDEAL AI CORE — §20/§21 "second real provider / provider-independent
 * mission ownership" (06/09/2026). Deuxième adaptateur ModelProvider RÉEL —
 * même interface qu'AnthropicProvider (provider.ts), jamais une forme
 * spéculative devinée à l'avance (voir la règle déjà écrite dans ce
 * fichier : "chaque méthode s'ajoute le jour où un appelant réel en a
 * besoin"). Chat Completions (pas encore Responses API) — suffisant pour
 * `generate()`, la seule méthode réellement appelée aujourd'hui par le Job
 * Engine/Supervisor.
 *
 * HONNÊTETÉ (§94/§95) : aucune clé OPENAI_API_KEY n'est configurée dans cet
 * environnement au moment de l'écriture de ce fichier — ce N'EST PAS une
 * raison de ne pas écrire l'adaptateur (implémentation manquante ≠ blocage
 * valable, §95), mais une raison honnête pour laquelle son health check
 * rapporte DISABLED tant que l'Owner n'a pas configuré la variable — un vrai
 * blocage Owner (crédential), documenté dans le rapport de session comme
 * READY_FOR_OWNER_AUTHORIZATION, jamais caché ni simulé.
 */

// Tarifs indicatifs (USD/1M tokens) — à revérifier contre platform.openai.com/docs/pricing
// avant tout usage réel à volume (même règle §57 que anthropic.ts : ne
// jamais se fier à la mémoire d'entraînement pour un tarif en production).
const OPENAI_CAPABILITIES: Record<string, ModelCapabilities> = {
  "gpt-4o-mini": { maxContextTokens: 128_000, vision: true, toolUse: true, costPerMTokIn: 0.15, costPerMTokOut: 0.6 },
  "gpt-4o": { maxContextTokens: 128_000, vision: true, toolUse: true, costPerMTokIn: 2.5, costPerMTokOut: 10 },
};

export function listOpenAiModelIds(): string[] {
  return Object.keys(OPENAI_CAPABILITIES);
}

interface OpenAiChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export class OpenAiProvider implements ModelProvider {
  readonly name = "openai";

  capabilities(model: string): ModelCapabilities | null {
    return OPENAI_CAPABILITIES[model] ?? null;
  }

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY absent — provider OpenAI non configuré (READY_FOR_OWNER_AUTHORIZATION, voir rapport de session).");

    if (req.webSearch) throw new Error('Le provider OpenAI (Chat Completions) ne supporte pas "webSearch" dans cette fondation — réservé à AnthropicProvider (web_search_20250305).');

    const content =
      req.images && req.images.length > 0
        ? (() => {
            const caps = this.capabilities(req.model);
            if (!caps?.vision) throw new Error(`Le modèle "${req.model}" n'a pas la capacité vision — impossible d'envoyer ${req.images!.length} image(s).`);
            return [
              { type: "text", text: req.userMessage },
              ...req.images.map((img) => ({ type: "image_url", image_url: { url: `data:${img.mediaType};base64,${img.data}` } })),
            ];
          })()
        : req.userMessage;

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: req.model,
        max_tokens: req.maxTokens,
        messages: [
          { role: "system", content: req.system },
          { role: "user", content },
        ],
      }),
    });
    if (!res.ok) throw new Error(`OpenAI API a répondu ${res.status}.`);

    const json = (await res.json()) as OpenAiChatResponse;
    const text = json.choices?.[0]?.message?.content ?? "";
    return {
      text,
      citations: [], // Chat Completions ne renvoie pas de citations natives — jamais fabriquées
      tokensIn: json.usage?.prompt_tokens ?? null,
      tokensOut: json.usage?.completion_tokens ?? null,
    };
  }
}

/** Health check RÉEL (§19 "Anthropic health" généralisé à tout provider) — un appel léger, jamais une déduction de la présence de la clé seule. */
export async function openAiHealthCheck(): Promise<{ status: "AVAILABLE" | "DISABLED" | "ERROR" | "RATE_LIMITED"; detail: string }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { status: "DISABLED", detail: "OPENAI_API_KEY non configurée — connecteur prêt, en attente d'autorisation Owner." };
  try {
    const res = await fetch("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${apiKey}` } });
    if (res.status === 429) return { status: "RATE_LIMITED", detail: "Limite de débit OpenAI atteinte." };
    if (!res.ok) return { status: "ERROR", detail: `L'API OpenAI a répondu ${res.status}.` };
    return { status: "AVAILABLE", detail: "Connexion réelle vérifiée à l'instant." };
  } catch (err) {
    return { status: "ERROR", detail: err instanceof Error ? err.message : "Erreur réseau." };
  }
}
