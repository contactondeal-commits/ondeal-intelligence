import type { GenerateRequest, GenerateResult, ModelCapabilities, ModelProvider } from "@/lib/ai/providers/provider";

/**
 * Seul adaptateur concret aujourd'hui — reflète EXACTEMENT l'appel déjà
 * fait en dur dans src/lib/intelligence/assistant.ts (même endpoint, même
 * en-têtes, même forme de tools). Ce fichier ne remplace pas encore ce code
 * (voir provider.ts) — il rend simplement le même comportement réutilisable
 * par un futur appelant (Job Engine) sans dupliquer le fetch une seconde
 * fois ailleurs.
 */
const ANTHROPIC_CAPABILITIES: Record<string, ModelCapabilities> = {
  "claude-haiku-4-5-20251001": { maxContextTokens: 200_000, vision: true, toolUse: true, costPerMTokIn: 1, costPerMTokOut: 5 },
  "claude-fable-5-1": { maxContextTokens: 200_000, vision: true, toolUse: true, costPerMTokIn: 3, costPerMTokOut: 15 },
};

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
        messages: [{ role: "user", content: req.userMessage }],
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
