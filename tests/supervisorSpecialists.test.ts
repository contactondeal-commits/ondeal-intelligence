import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { analystSystemPrompt, callStructuredSpecialist, criticDataSchema, judgeDataSchema } from "@/lib/ai/supervisor/specialists";

/**
 * ONDEAL AI CORE — PHASE 4 : tests de la machinerie spécialiste générique
 * (06/09/2026), §7. Même convention que tests/coderVision.test.ts : aucune
 * vraie base, "@/lib/db" mocké pour que chooseModel retombe explicitement
 * sur DEFAULT_MODEL, et un provider double (jamais un réseau réel).
 */

vi.mock("@/lib/db", () => ({
  prisma: {
    modelEvalRun: { findMany: vi.fn().mockResolvedValue([]) },
    modelEvalResult: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

afterEach(() => {
  vi.clearAllMocks();
});

function fakeProvider(generateText: string) {
  return {
    name: "anthropic",
    capabilities: () => ({ maxContextTokens: 200_000, vision: false, toolUse: true, costPerMTokIn: 3, costPerMTokOut: 15 }),
    generate: vi.fn().mockResolvedValue({ text: generateText, citations: [], tokensIn: 200, tokensOut: 80 }),
  };
}

const envelope = (data: unknown) => JSON.stringify({ findings: ["f1"], evidence: ["e1"], uncertainties: [], recommendations: ["r1"], confidence: 0.7, data });

describe("callStructuredSpecialist — enveloppe + schéma de rôle", () => {
  it("valide l'enveloppe ET le schéma spécifique au rôle, calcule un coût réel à partir du VRAI provider (pas de la chaîne choice.provider)", async () => {
    const provider = fakeProvider(envelope({ verdict: "PASS", blockingIssues: [], weaknesses: [], rejectionCase: "Pourrait manquer de preuve mobile réelle." }));
    const result = await callStructuredSpecialist(provider, "storefront_critic_v1", "system", "user", criticDataSchema);
    expect(result.output.data.verdict).toBe("PASS");
    expect(result.output.data.rejectionCase).toMatch(/mobile/);
    // coût = (200 * 3 + 80 * 15) / 1_000_000 — calculé à partir des tokens RÉELS + capabilities du provider passé, jamais fabriqué.
    expect(result.costUsd).toBeCloseTo((200 * 3 + 80 * 15) / 1_000_000, 9);
    expect(result.tokensIn).toBe(200);
    expect(result.tokensOut).toBe(80);
  });

  it("accepte un JSON entouré de balises markdown", async () => {
    const provider = fakeProvider("```json\n" + envelope({ verdict: "READY_FOR_RELEASE", justification: "ok", evidenceReviewed: ["diff", "screenshot"] }) + "\n```");
    const result = await callStructuredSpecialist(provider, "storefront_judge_v1", "system", "user", judgeDataSchema);
    expect(result.output.data.verdict).toBe("READY_FOR_RELEASE");
  });

  it("refuse (lève) plutôt que d'inventer un verdict quand la sortie n'est pas un JSON valide", async () => {
    const provider = fakeProvider("ceci n'est pas du JSON");
    await expect(callStructuredSpecialist(provider, "storefront_critic_v1", "system", "user", criticDataSchema)).rejects.toThrow(/JSON valide/);
  });

  it("refuse quand l'enveloppe est incomplète (ex. confidence manquant)", async () => {
    const provider = fakeProvider(JSON.stringify({ findings: [], evidence: [], uncertainties: [], recommendations: [], data: {} }));
    await expect(callStructuredSpecialist(provider, "storefront_critic_v1", "system", "user", criticDataSchema)).rejects.toThrow(/enveloppe/);
  });

  it("refuse quand le champ data ne respecte pas le schéma du rôle (verdict absent, jamais un rejectionCase inventé)", async () => {
    const provider = fakeProvider(envelope({ verdict: "PASS" })); // rejectionCase manquant — OBLIGATOIRE (§38)
    await expect(callStructuredSpecialist(provider, "storefront_critic_v1", "system", "user", criticDataSchema)).rejects.toThrow(/rôle/);
  });

  it("retourne un coût null quand le provider ne rapporte pas les tokens — jamais un 0$ inventé", async () => {
    const provider = {
      name: "anthropic",
      capabilities: () => ({ maxContextTokens: 200_000, vision: false, toolUse: true, costPerMTokIn: 3, costPerMTokOut: 15 }),
      generate: vi.fn().mockResolvedValue({ text: envelope({ verdict: "PASS", blockingIssues: [], weaknesses: [], rejectionCase: "x" }), citations: [], tokensIn: null, tokensOut: null }),
    };
    const result = await callStructuredSpecialist(provider, "storefront_critic_v1", "system", "user", criticDataSchema);
    expect(result.costUsd).toBeUndefined();
    expect(result.tokensIn).toBeNull();
  });

  it("accepte un dataSchema arbitraire (ex. z.object({}).passthrough() pour les analystes génériques)", async () => {
    const provider = fakeProvider(envelope({ anything: "goes", nested: { ok: true } }));
    const schema = z.object({}).passthrough();
    const result = await callStructuredSpecialist(provider, "storefront_analysis_v1", "system", "user", schema);
    expect(result.output.data).toEqual({ anything: "goes", nested: { ok: true } });
  });
});

describe("analystSystemPrompt — cohérence par rôle", () => {
  it("intègre le rôle et le focus fournis, sans dupliquer un prompt générique par rôle", () => {
    const prompt = analystSystemPrompt("Brand Strategist", "positionnement de marque");
    expect(prompt).toContain("Brand Strategist");
    expect(prompt).toContain("positionnement de marque");
    expect(prompt).toMatch(/JSON/);
  });
});
