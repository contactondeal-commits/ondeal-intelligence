import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAiImageProvider, imageGenerationHealthCheck } from "@/lib/ai/providers/imageGeneration";

/**
 * ONDEAL AI CORE — §41/§202 "provider de génération d'image" (06/09/2026),
 * clôture réelle.
 *
 * Verrouille OpenAiImageProvider.generateImage :
 *   - PNG réel (base64) retourné, jamais une image de substitution.
 *   - Coût RÉEL calculé depuis la grille tarifaire taille×qualité — jamais
 *     un coût nul/inventé pour un appel réellement facturé.
 *   - Refuse (lève) plutôt que d'inventer une image quand l'API ne renvoie
 *     aucun b64_json, ou répond une erreur HTTP, ou quand OPENAI_API_KEY est
 *     absente (READY_FOR_OWNER_AUTHORIZATION honnête, jamais un succès
 *     simulé).
 *   - imageGenerationHealthCheck délègue au health check OpenAI existant
 *     (même compte, même clé) — jamais un second mécanisme dupliqué.
 */

const originalOpenAiKey = process.env.OPENAI_API_KEY;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalOpenAiKey;
});

describe("OpenAiImageProvider.generateImage", () => {
  it("génère une image réelle et calcule le coût exact (taille × qualité)", async () => {
    process.env.OPENAI_API_KEY = "sk-test-fake";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ b64_json: "ZmFrZS1wbmc=", revised_prompt: "un prompt révisé par le modèle" }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenAiImageProvider();
    const result = await provider.generateImage({ prompt: "un t-shirt sur fond blanc", size: "1024x1792", quality: "hd" });

    expect(result.imageBase64).toBe("ZmFrZS1wbmc=");
    expect(result.mediaType).toBe("image/png");
    expect(result.provider).toBe("openai");
    expect(result.model).toBe("dall-e-3");
    expect(result.revisedPrompt).toBe("un prompt révisé par le modèle");
    expect(result.costUsd).toBeCloseTo(0.12, 9); // grille hd/1024x1792

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.com/v1/images/generations",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer sk-test-fake" }),
      }),
    );
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body);
    expect(body).toEqual({ model: "dall-e-3", prompt: "un t-shirt sur fond blanc", size: "1024x1792", quality: "hd", n: 1, response_format: "b64_json" });
  });

  it("applique les défauts (1024x1024, standard) quand size/quality sont omis", async () => {
    process.env.OPENAI_API_KEY = "sk-test-fake";
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [{ b64_json: "ZmFrZQ==" }] }) });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenAiImageProvider();
    const result = await provider.generateImage({ prompt: "logo minimaliste" });
    expect(result.costUsd).toBeCloseTo(0.04, 9); // grille standard/1024x1024
    expect(result.revisedPrompt).toBeNull();
  });

  it("refuse (lève) sans appeler l'API quand OPENAI_API_KEY est absente", async () => {
    delete process.env.OPENAI_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenAiImageProvider();
    await expect(provider.generateImage({ prompt: "x" })).rejects.toThrow(/OPENAI_API_KEY absent/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuse (lève) quand l'API répond une erreur HTTP, avec le corps de la réponse dans le message", async () => {
    process.env.OPENAI_API_KEY = "sk-test-fake";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => '{"error":{"message":"prompt rejeté par la modération"}}' }),
    );

    const provider = new OpenAiImageProvider();
    await expect(provider.generateImage({ prompt: "x" })).rejects.toThrow(/400.*modération/s);
  });

  it("refuse (lève) plutôt que d'inventer une image quand b64_json est absent de la réponse", async () => {
    process.env.OPENAI_API_KEY = "sk-test-fake";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [{}] }) }));

    const provider = new OpenAiImageProvider();
    await expect(provider.generateImage({ prompt: "x" })).rejects.toThrow(/aucune image/);
  });
});

describe("imageGenerationHealthCheck", () => {
  it("DISABLED quand OPENAI_API_KEY est absente (même mécanisme que openAiHealthCheck)", async () => {
    delete process.env.OPENAI_API_KEY;
    const result = await imageGenerationHealthCheck();
    expect(result.status).toBe("DISABLED");
  });

  it("AVAILABLE quand OPENAI_API_KEY est présente et l'API répond ok", async () => {
    process.env.OPENAI_API_KEY = "sk-test-fake";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200 }));
    const result = await imageGenerationHealthCheck();
    expect(result.status).toBe("AVAILABLE");
  });
});
