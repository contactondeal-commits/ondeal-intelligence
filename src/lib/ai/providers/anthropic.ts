import type { GenerateRequest, GenerateResult, ModelCapabilities, ModelProvider } from "@/lib/ai/providers/provider";

/**
 * Seul adaptateur concret aujourd'hui — reflète EXACTEMENT l'appel déjà
 * fait en dur dans src/lib/intelligence/assistant.ts (même endpoint, même
 * en-têtes, même forme de tools). Ce fichier ne remplace pas encore ce code
 * (voir provider.ts) — il rend simplement le même comportement réutilisable
 * par un futur appelant (Job Engine) sans dupliquer le fetch une seconde
 * fois ailleurs.
 */
// Tarifs vérifiés le 06/09/2026 contre la documentation officielle
// (platform.claude.com/docs/en/about-claude/models/overview et
// claude.com/pricing — les deux sources concordent). RÈGLE §57 de la
// commande d'exécution : ne jamais se fier à la mémoire pour un tarif, TOUJOURS
// revérifier la doc officielle avant d'utiliser un chiffre de coût. Le tarif
// précédent de claude-fable-5-1 (3$/15$) était FAUX (deviné, jamais vérifié) —
// corrigé ici vers le tarif officiel réel. maxContextTokens pour fable est
// également corrigé (1M, pas 200K, par la même doc).
const ANTHROPIC_CAPABILITIES: Record<string, ModelCapabilities> = {
  "claude-haiku-4-5-20251001": { maxContextTokens: 200_000, vision: true, toolUse: true, costPerMTokIn: 1, costPerMTokOut: 5 },
  "claude-fable-5-1": { maxContextTokens: 1_000_000, vision: true, toolUse: true, costPerMTokIn: 10, costPerMTokOut: 50 },
};

// PHASE 5 (06/09/2026) — exporté pour le Model Console (AI Lab Ultimate,
// §"AI LAB → MODELS") : liste RÉELLE des modèles connus par ce provider,
// jamais une liste dupliquée à la main ailleurs.
export function listAnthropicModelIds(): string[] {
  return Object.keys(ANTHROPIC_CAPABILITIES);
}

interface AnthropicContentBlock {
  type: string;
  text?: string;
  citations?: Array<{ url?: string; title?: string }>;
}

interface AnthropicResponse {
  content?: AnthropicContentBlock[];
  usage?: { input_tokens?: number; output_tokens?: number };
}

export class AnthropicProvider implements ModelProvider {
  readonly name = "anthropic";

  capabilities(model: string): ModelCapabilities | null {
    return ANTHROPIC_CAPABILITIES[model] ?? null;
  }

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY absent — aucun appel modèle possible.");

    // PHASE 3 : refuse explicitement (jamais un envoi silencieux dégradé en
    // texte seul) une requête avec images si le modèle ciblé n'a pas
    // vision:true dans son catalogue de capacités — voir provider.ts.
    if (req.images && req.images.length > 0) {
      const caps = this.capabilities(req.model);
      if (!caps?.vision) {
        throw new Error(`Le modèle "${req.model}" n'a pas la capacité vision — impossible d'envoyer ${req.images.length} image(s).`);
      }
    }

    const userContent =
      req.images && req.images.length > 0
        ? [
            ...req.images.map((img) => ({
              type: "image",
              source: { type: "base64", media_type: img.mediaType, data: img.data },
            })),
            { type: "text", text: req.userMessage },
          ]
        : req.userMessage;

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: req.model,
        max_tokens: req.maxTokens,
        system: req.system,
        messages: [{ role: "user", content: userContent }],
        ...(req.webSearch
          ? { tools: [{ type: "web_search_20250305", name: "web_search", max_uses: req.webSearch.maxUses }] }
          : {}),
      }),
    });
    if (!res.ok) throw new Error(`Anthropic API a répondu ${res.status}.`);

    const json = (await res.json()) as AnthropicResponse;
    const textBlocks = (json.content ?? []).filter((c) => c.type === "text" && c.text);
    const text = textBlocks.map((b) => b.text).join("\n");

    const citationsByUrl = new Map<string, string | null>();
    for (const block of textBlocks) {
      for (const cite of block.citations ?? []) {
        if (cite.url && !citationsByUrl.has(cite.url)) citationsByUrl.set(cite.url, cite.title ?? null);
      }
    }

    return {
      text,
      citations: [...citationsByUrl.entries()].map(([url, title]) => ({ url, title })),
      tokensIn: json.usage?.input_tokens ?? null,
      tokensOut: json.usage?.output_tokens ?? null,
    };
  }
}
