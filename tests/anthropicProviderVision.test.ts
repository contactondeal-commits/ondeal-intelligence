import { afterEach, describe, expect, it, vi } from "vitest";
import { AnthropicProvider } from "@/lib/ai/providers/anthropic";

/**
 * ONDEAL AI CORE — PHASE 3 : tests du support vision d'AnthropicProvider
 * (06/09/2026). Vérifie que `generate({images})` (1) construit RÉELLEMENT
 * des blocs de contenu image (jamais un texte substitué), et (2) refuse
 * explicitement d'envoyer des images à un modèle dont `capabilities().vision`
 * est faux — jamais un envoi silencieusement dégradé.
 */

const ORIGINAL_KEY = process.env.ANTHROPIC_API_KEY;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (ORIGINAL_KEY === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = ORIGINAL_KEY;
});

describe("AnthropicProvider.generate — images", () => {
  it("construit un message multimodal (image + texte) pour un modèle vision", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: "text", text: "ok" }], usage: { input_tokens: 10, output_tokens: 5 } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new AnthropicProvider();
    await provider.generate({
      model: "claude-haiku-4-5-20251001",
      system: "s",
      userMessage: "décris cette image",
      maxTokens: 100,
      images: [{ mediaType: "image/png", data: "ZmFrZS1wbmc=" }],
    });

    const body = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body);
    expect(body.messages[0].content).toEqual([
      { type: "image", source: { type: "base64", media_type: "image/png", data: "ZmFrZS1wbmc=" } },
      { type: "text", text: "décris cette image" },
    ]);
  });

  it("refuse (lève) plutôt que d'envoyer silencieusement en texte seul, pour un modèle sans capacité vision", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const provider = new AnthropicProvider();
    await expect(
      provider.generate({
        model: "modele-sans-vision-inconnu",
        system: "s",
        userMessage: "x",
        maxTokens: 10,
        images: [{ mediaType: "image/png", data: "ZmFrZQ==" }],
      }),
    ).rejects.toThrow(/vision/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reste un simple message texte (pas de bloc image) quand aucune image n'est fournie", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: "text", text: "ok" }], usage: { input_tokens: 1, output_tokens: 1 } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new AnthropicProvider();
    await provider.generate({ model: "claude-haiku-4-5-20251001", system: "s", userMessage: "bonjour", maxTokens: 10 });

    const body = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body);
    expect(body.messages[0].content).toBe("bonjour");
  });
});
