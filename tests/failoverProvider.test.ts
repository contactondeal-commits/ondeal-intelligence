import { describe, expect, it, vi } from "vitest";
import { AllCandidatesFailedError, FailoverProvider, classifyFailure } from "@/lib/ai/providers/failover";
import type { GenerateRequest, GenerateResult, ModelCapabilities, ModelProvider } from "@/lib/ai/providers/provider";

/**
 * ONDEAL AI CORE — §22-32 "provider continuity" (06/09/2026), clôture réelle.
 *
 * Verrouille :
 *   - Le failover essaie les candidats DANS L'ORDRE, jamais un choix
 *     aléatoire, et rapporte QUI a réellement servi (servedBy) + l'historique
 *     visible des tentatives précédentes (failoverAttempts) — jamais un
 *     fallback muet (§32).
 *   - Capability-aware : un candidat incompatible (webSearch non supporté,
 *     pas de vision) est écarté SANS appel réseau.
 *   - Classification de panne mécanique sur le message réel observé.
 *   - Tous les candidats épuisés → AllCandidatesFailedError explicite,
 *     jamais un succès fabriqué.
 */

function fakeProvider(name: string, caps: ModelCapabilities, impl: (req: GenerateRequest) => Promise<GenerateResult>): ModelProvider {
  return { name, capabilities: () => caps, generate: impl };
}

const TEXT_CAPS: ModelCapabilities = { maxContextTokens: 100_000, vision: false, toolUse: false, costPerMTokIn: 1, costPerMTokOut: 1 };
const VISION_CAPS: ModelCapabilities = { ...TEXT_CAPS, vision: true };

describe("classifyFailure — taxonomie mécanique sur le message réel observé", () => {
  it("classe une erreur 429 en RATE_LIMIT", () => {
    expect(classifyFailure(new Error("429 Too Many Requests")).category).toBe("RATE_LIMIT");
  });
  it("classe une clé absente en PROVIDER_DOWN", () => {
    expect(classifyFailure(new Error("OPENAI_API_KEY absent — provider OpenAI non configuré")).category).toBe("PROVIDER_DOWN");
  });
  it("classe un timeout en MODEL_TIMEOUT", () => {
    expect(classifyFailure(new Error("Request timeout after 30s")).category).toBe("MODEL_TIMEOUT");
  });
  it("classe une erreur non reconnue en UNKNOWN, jamais une catégorie inventée", () => {
    expect(classifyFailure(new Error("quelque chose de complètement inattendu")).category).toBe("UNKNOWN");
  });
});

describe("FailoverProvider — continuité réelle multi-provider", () => {
  it("réussit du premier coup : servedBy renseigné, failoverAttempts absent (jamais un historique vide fabriqué)", async () => {
    const anthropic = fakeProvider("anthropic", TEXT_CAPS, async () => ({ text: "ok", citations: [], tokensIn: 10, tokensOut: 5 }));
    const fp = new FailoverProvider([{ provider: anthropic, model: "claude-haiku-4-5" }]);
    const result = await fp.generate({ model: "ignored", system: "s", userMessage: "u", maxTokens: 100 });
    expect(result.text).toBe("ok");
    expect(result.servedBy).toEqual({ provider: "anthropic", model: "claude-haiku-4-5" });
    expect(result.failoverAttempts).toBeUndefined();
  });

  it("bascule sur le second candidat si le premier échoue — jamais un fallback muet (failoverAttempts visible)", async () => {
    const failing = fakeProvider("anthropic", TEXT_CAPS, async () => {
      throw new Error("503 Service Unavailable");
    });
    const backup = fakeProvider("openai", TEXT_CAPS, async () => ({ text: "backup réussi", citations: [], tokensIn: 8, tokensOut: 4 }));
    const fp = new FailoverProvider([
      { provider: failing, model: "claude-haiku-4-5" },
      { provider: backup, model: "gpt-4o-mini" },
    ]);
    const result = await fp.generate({ model: "ignored", system: "s", userMessage: "u", maxTokens: 100 });
    expect(result.text).toBe("backup réussi");
    expect(result.servedBy).toEqual({ provider: "openai", model: "gpt-4o-mini" });
    expect(result.failoverAttempts).toHaveLength(1);
    expect(result.failoverAttempts![0]!.provider).toBe("anthropic");
    expect(result.failoverAttempts![0]!.failureCategory).toBe("PROVIDER_DOWN");
  });

  it("capability-aware : écarte un candidat non-vision SANS appel réseau quand des images sont requises", async () => {
    const textOnly = vi.fn(async () => ({ text: "jamais appelé", citations: [], tokensIn: null, tokensOut: null }));
    const visionCapable = fakeProvider("anthropic", VISION_CAPS, async () => ({ text: "vu", citations: [], tokensIn: 1, tokensOut: 1 }));
    const fp = new FailoverProvider([
      { provider: fakeProvider("openai", TEXT_CAPS, textOnly), model: "gpt-4o-mini-vtest" },
      { provider: visionCapable, model: "claude-haiku-vtest" },
    ]);
    const result = await fp.generate({ model: "ignored", system: "s", userMessage: "u", maxTokens: 100, images: [{ mediaType: "image/png", data: "abc" }] });
    expect(textOnly).not.toHaveBeenCalled();
    expect(result.text).toBe("vu");
    expect(result.servedBy?.provider).toBe("anthropic");
  });

  it("capability-aware : écarte un candidat non-anthropic quand webSearch est requis", async () => {
    const openaiCalled = vi.fn(async () => ({ text: "jamais appelé", citations: [], tokensIn: null, tokensOut: null }));
    const anthropic = fakeProvider("anthropic", TEXT_CAPS, async () => ({ text: "recherche web ok", citations: [], tokensIn: 1, tokensOut: 1 }));
    const fp = new FailoverProvider([
      { provider: fakeProvider("openai", TEXT_CAPS, openaiCalled), model: "gpt-4o-mini-wtest" },
      { provider: anthropic, model: "claude-haiku-wtest" },
    ]);
    const result = await fp.generate({ model: "ignored", system: "s", userMessage: "u", maxTokens: 100, webSearch: { maxUses: 1 } });
    expect(openaiCalled).not.toHaveBeenCalled();
    expect(result.servedBy?.provider).toBe("anthropic");
  });

  it("respecte le plafond de coût pire-cas (maxCostPerCallUsd) — écarte le candidat sans appel réseau", async () => {
    const expensive = vi.fn(async () => ({ text: "jamais appelé", citations: [], tokensIn: null, tokensOut: null }));
    const cheap = fakeProvider("openai", { ...TEXT_CAPS, costPerMTokOut: 0.1 }, async () => ({ text: "abordable", citations: [], tokensIn: 1, tokensOut: 1 }));
    const fp = new FailoverProvider([
      { provider: fakeProvider("anthropic", { ...TEXT_CAPS, costPerMTokOut: 100 }, expensive), model: "claude-opus", maxCostPerCallUsd: 0.01 },
      { provider: cheap, model: "gpt-4o-mini" },
    ]);
    const result = await fp.generate({ model: "ignored", system: "s", userMessage: "u", maxTokens: 10_000 });
    expect(expensive).not.toHaveBeenCalled();
    expect(result.servedBy?.provider).toBe("openai");
  });

  it("lève AllCandidatesFailedError explicite quand TOUS les candidats échouent — jamais un succès fabriqué", async () => {
    const a = fakeProvider("anthropic", TEXT_CAPS, async () => {
      throw new Error("500 Internal Server Error");
    });
    const b = fakeProvider("openai", TEXT_CAPS, async () => {
      throw new Error("429 rate limit");
    });
    const fp = new FailoverProvider([{ provider: a, model: "m1" }, { provider: b, model: "m2" }]);
    await expect(fp.generate({ model: "ignored", system: "s", userMessage: "u", maxTokens: 100 })).rejects.toThrow(AllCandidatesFailedError);
  });
});
