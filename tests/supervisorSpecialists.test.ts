import { afterEach, describe, expect, it, vi } from "vitest";
import type { GenerateRequest, GenerateResult, ModelProvider } from "@/lib/ai/providers/provider";
import { z } from "zod";
import { analystSystemPrompt, callStructuredSpecialist, criticDataSchema, extractJson, judgeDataSchema } from "@/lib/ai/supervisor/specialists";

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

  it("§22-32 : quand result.servedBy est renseigné (composite FailoverProvider), rapporte le VRAI candidat qui a servi — jamais choice.provider/choice.model, jamais un mensonge d'observabilité", async () => {
    const provider = {
      name: "failover",
      // capabilities("gpt-4o-mini") renvoie les tarifs OpenAI — jamais ceux d'Anthropic (choice.model), cohérent avec un composite qui cherche parmi SES candidats.
      capabilities: (model: string) => (model === "gpt-4o-mini" ? { maxContextTokens: 128_000, vision: true, toolUse: true, costPerMTokIn: 0.15, costPerMTokOut: 0.6 } : null),
      generate: vi.fn().mockResolvedValue({
        text: envelope({ verdict: "PASS", blockingIssues: [], weaknesses: [], rejectionCase: "x" }),
        citations: [],
        tokensIn: 200,
        tokensOut: 80,
        servedBy: { provider: "openai", model: "gpt-4o-mini" },
        failoverAttempts: [{ provider: "anthropic", model: "claude-haiku-4-5-20251001", failureCategory: "PROVIDER_DOWN", message: "503" }],
      }),
    };
    const result = await callStructuredSpecialist(provider, "storefront_critic_v1", "system", "user", criticDataSchema);
    expect(result.provider).toBe("openai");
    expect(result.model).toBe("gpt-4o-mini");
    expect(result.failoverAttempts).toEqual([{ provider: "anthropic", model: "claude-haiku-4-5-20251001", failureCategory: "PROVIDER_DOWN", message: "503" }]);
    // coût calculé sur les tarifs OpenAI (0.6$/M out), pas ceux d'Anthropic.
    expect(result.costUsd).toBeCloseTo((200 * 0.15 + 80 * 0.6) / 1_000_000, 9);
  });

  it("sans servedBy (provider simple, jamais de failover) : rapporte choice.provider/choice.model comme avant, failoverAttempts absent", async () => {
    const provider = fakeProvider(envelope({ verdict: "PASS", blockingIssues: [], weaknesses: [], rejectionCase: "x" }));
    const result = await callStructuredSpecialist(provider, "storefront_critic_v1", "system", "user", criticDataSchema);
    expect(result.provider).toBe("anthropic");
    expect(result.failoverAttempts).toBeUndefined();
  });

  it("accepte un dataSchema arbitraire (ex. z.object({}).passthrough() pour les analystes génériques)", async () => {
    const provider = fakeProvider(envelope({ anything: "goes", nested: { ok: true } }));
    const schema = z.object({}).passthrough();
    const result = await callStructuredSpecialist(provider, "storefront_analysis_v1", "system", "user", schema);
    expect(result.output.data).toEqual({ anything: "goes", nested: { ok: true } });
  });
});

/**
 * RÉGRESSION — BUG DE PRODUCTION RÉEL, 3e panne de la chaîne provider→parser
 * (06/09/2026, une fois ANTHROPIC_API_KEY effectivement configurée en
 * production) : "Sortie spécialiste : pas un JSON valide" sur une réponse
 * ```json { "findings": [...], ... tronquée en plein milieu d'une valeur
 * (signature d'une troncature par max_tokens, jamais un JSON réellement
 * malformé). Verrouille exactement les cas exigés par le mandat de
 * l'Owner : JSON brut, fence fermé (json/sans tag), JSON invalide, prose +
 * JSON mélangés, ET la reproduction de la sortie tronquée réelle — jamais
 * un assouplissement du parser qui accepterait un JSON partiel/deviné.
 */
describe("extractJson — root cause réelle (fence non ancré + troncature max_tokens jamais diagnostiquée)", () => {
  it("accepte du JSON brut, sans aucun fence Markdown", () => {
    expect(extractJson('{"nodes":[{"key":"a"}]}')).toEqual({ nodes: [{ key: "a" }] });
  });

  it("accepte la même enveloppe entourée d'un fence ```json ... ``` fermé", () => {
    const json = '{"nodes":[{"key":"a"}]}';
    expect(extractJson("```json\n" + json + "\n```")).toEqual({ nodes: [{ key: "a" }] });
  });

  it("accepte la même enveloppe entourée d'un fence ``` ... ``` fermé SANS étiquette \"json\"", () => {
    const json = '{"nodes":[{"key":"a"}]}';
    expect(extractJson("```\n" + json + "\n```")).toEqual({ nodes: [{ key: "a" }] });
  });

  it("refuse un JSON syntaxiquement invalide (sans fence) — jamais une réparation silencieuse", () => {
    expect(() => extractJson('{"nodes":[{"key":"a",}]}')).toThrow(/JSON valide/);
  });

  it("refuse une réponse \"prose + JSON mélangés\" — jamais une extraction \"cachée\" dans le texte", () => {
    expect(() => extractJson('Voici le plan demandé :\n{"nodes":[{"key":"a"}]}\nMerci de votre patience.')).toThrow(/JSON valide/);
  });

  it("refuse une réponse avec du texte AVANT un fence par ailleurs valide — jamais un fence \"trouvé\" au milieu d'une réponse non strictement structurée", () => {
    const json = '{"nodes":[{"key":"a"}]}';
    expect(() => extractJson("Voici le résultat :\n```json\n" + json + "\n```")).toThrow(/JSON valide/);
  });

  it("REPRODUCTION EXACTE de la sortie de production réelle : fence ouvert, jamais refermé (troncature max_tokens) — refusé, avec un message qui NOMME explicitement la troncature probable", () => {
    // Extrait fidèle de l'erreur observée en production (mission Owner réelle) :
    // coupure en plein milieu d'une valeur, aucun fence fermant, aucune
    // accolade fermante — jamais un JSON réellement malformé "classique".
    const truncatedProductionOutput =
      '```json\n{ "findings": [ "OnDeal Intelligence possède une architecture React/Next.js complète avec authentification, routing et 27 composants métier spécialisés pour l\'e-commerce. L\'application est un SaaS B2B d\'analyse, non un storefront.", "Le design système est entièrement défini (tokens';
    expect(() => extractJson(truncatedProductionOutput)).toThrow(/JSON valide/);
    try {
      extractJson(truncatedProductionOutput);
      expect.unreachable("devait lever");
    } catch (err) {
      const message = (err as Error).message;
      // Le correctif doit EXPLICITEMENT nommer la cause probable (troncature
      // max_tokens) — jamais laisser deviner après coup comme c'était le cas
      // en production avant ce correctif.
      expect(message).toMatch(/tronqu.*max_tokens|max_tokens.*tronqu/i);
      expect(message).toContain("Le design système");
    }
  });

  it("refuse un JSON complet mais dont le champ data ne respecte pas le schéma du rôle — vérifié au niveau callStructuredSpecialist, pas extractJson (voir describe ci-dessus)", async () => {
    const provider = fakeProvider(envelope({ verdict: "PASS" })); // rejectionCase manquant
    await expect(callStructuredSpecialist(provider, "storefront_critic_v1", "system", "user", criticDataSchema)).rejects.toThrow(/rôle/);
  });
});

/**
 * RÉGRESSION — CORRECTIF ARCHITECTURAL, 5e panne réelle de la même chaîne
 * (06/09/2026), couche d'EXÉCUTION des spécialistes (après que le correctif
 * du planner, déjà verrouillé ci-dessus dans supervisorGraphRunner.test.ts,
 * ait permis au graphe d'obtenir >0 nodes) : plusieurs nodes réels
 * (researcher, adversarial_critic, ux_architect, performance_reviewer)
 * échouaient ENCORE avec "pas un JSON valide" / troncature max_tokens,
 * malgré le budget déjà relevé pour le planner. Verrouille la détection
 * DÉFINITIVE via le signal RÉEL du provider (stop_reason/finish_reason
 * normalisé en "max_tokens", provider.ts) — jamais seulement l'heuristique
 * de fence non refermé (qui reste un FILET DE SÉCURITÉ, testé séparément
 * ci-dessous) — et la reprise contrôlée UNE SEULE FOIS avec budget doublé +
 * consigne de concision, jamais une réparation du JSON partiel ni une
 * boucle non bornée.
 */
describe("callStructuredSpecialist — détection de troncature via stop_reason et reprise contrôlée (5e panne production 06/09/2026)", () => {
  function providerWithGenerate(generate: ModelProvider["generate"]): ModelProvider {
    return {
      name: "anthropic",
      capabilities: () => ({ maxContextTokens: 200_000, vision: false, toolUse: true, costPerMTokIn: 1, costPerMTokOut: 5 }),
      generate,
    };
  }

  it("reprise contrôlée UNE SEULE FOIS après troncature confirmée par stop_reason=max_tokens : succès si la reprise est complète, tokens/coût agrégés sur les DEUX tentatives", async () => {
    // Reproduction fidèle de la classe de panne réelle : fence ouvert, jamais
    // refermé, coupure en plein milieu d'une valeur — mais cette fois
    // accompagné du signal RÉEL du provider (stop_reason=max_tokens),
    // jamais seulement deviné après coup sur le texte.
    const truncatedText =
      '```json\n{ "findings": [ "a" ], "evidence": [ "b" ], "uncertainties": [], "recommendations": [], "confidence": 0.7, "data": { "verdict": "PASS", "blockingIssues": [], "weak';
    const completeText = envelope({ verdict: "PASS", blockingIssues: [], weaknesses: [], rejectionCase: "x" });
    let callCount = 0;
    const generate = vi.fn(async (_req: GenerateRequest): Promise<GenerateResult> => {
      callCount++;
      if (callCount === 1) return { text: truncatedText, citations: [], tokensIn: 500, tokensOut: 400, stopReason: "max_tokens" };
      return { text: completeText, citations: [], tokensIn: 300, tokensOut: 150, stopReason: "end_turn" };
    });
    const provider = providerWithGenerate(generate);

    const result = await callStructuredSpecialist(provider, "storefront_critic_v1", "system", "user", criticDataSchema, 2000);

    expect(generate).toHaveBeenCalledTimes(2);
    expect(result.output.data.verdict).toBe("PASS");
    // La reprise doit RÉELLEMENT porter un rappel de concision + un budget
    // doublé (jamais un simple retry muet du même prompt/budget qui
    // échouerait à nouveau de façon identique).
    const secondCallArgs = generate.mock.calls[1]![0] as GenerateRequest;
    expect(secondCallArgs.system).toMatch(/TRONQUÉE/);
    expect(secondCallArgs.system).toMatch(/BRIÈVETÉ/i);
    expect(secondCallArgs.maxTokens).toBe(4000); // 2000 doublé, sous MAX_RETRY_TOKENS
    // Coût/tokens réels agrégés sur LES DEUX tentatives — jamais seulement
    // la dernière (la première tentative tronquée a un coût bien réel elle
    // aussi, jamais silencieusement perdu).
    expect(result.tokensIn).toBe(500 + 300);
    expect(result.tokensOut).toBe(400 + 150);
  });

  it("refuse explicitement (jamais un JSON réparé/deviné) si la reprise est ELLE AUSSI tronquée (stop_reason=max_tokens confirmé deux fois) — jamais plus d'une seule reprise (pas de boucle non bornée)", async () => {
    const stillTruncated = '```json\n{ "findings": [ "a"';
    const generate = vi.fn(async (_req: GenerateRequest): Promise<GenerateResult> => ({
      text: stillTruncated,
      citations: [],
      tokensIn: 500,
      tokensOut: 400,
      stopReason: "max_tokens",
    }));
    const provider = providerWithGenerate(generate);

    await expect(callStructuredSpecialist(provider, "storefront_critic_v1", "system", "user", criticDataSchema, 2000)).rejects.toThrow(
      /stop_reason=max_tokens/i,
    );
    await expect(callStructuredSpecialist(provider, "storefront_critic_v1", "system", "user", criticDataSchema, 2000)).rejects.toThrow(
      /MÊME APRÈS/i,
    );
    // Exactement 2 tentatives PAR APPEL (les deux `await expect` ci-dessus
    // relancent chacun un cycle complet) — jamais une 3e tentative, jamais
    // une boucle non bornée.
    expect(generate).toHaveBeenCalledTimes(4);
  });

  it("filet de sécurité conservé : un provider qui NE rapporte PAS stop_reason (undefined) retombe sur l'heuristique existante d'extractJson (fence ouvert non refermé) — AUCUNE reprise déclenchée à tort (le signal ne dit jamais explicitement 'max_tokens')", async () => {
    const truncatedNoSignal = '```json\n{ "findings": [ "a"';
    const generate = vi.fn(async (_req: GenerateRequest): Promise<GenerateResult> => ({ text: truncatedNoSignal, citations: [], tokensIn: 500, tokensOut: 400 }));
    const provider = providerWithGenerate(generate);

    await expect(callStructuredSpecialist(provider, "storefront_critic_v1", "system", "user", criticDataSchema, 2000)).rejects.toThrow(/JSON valide/);
    expect(generate).toHaveBeenCalledTimes(1); // aucune reprise déclenchée : stop_reason n'a jamais dit "max_tokens".
  });

  it("faux positif évité (§10 du mandat) : une réponse VALIDE et COMPLÈTE proche de la limite de tokens, avec un stop_reason autre que max_tokens, n'est JAMAIS reprise inutilement", async () => {
    const completeNearLimit = envelope({ verdict: "PASS", blockingIssues: [], weaknesses: [], rejectionCase: "x".repeat(200) });
    const generate = vi.fn(async (_req: GenerateRequest): Promise<GenerateResult> => ({ text: completeNearLimit, citations: [], tokensIn: 500, tokensOut: 1990, stopReason: "end_turn" }));
    const provider = providerWithGenerate(generate);

    const result = await callStructuredSpecialist(provider, "storefront_critic_v1", "system", "user", criticDataSchema, 2000);

    expect(generate).toHaveBeenCalledTimes(1);
    expect(result.output.data.verdict).toBe("PASS");
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
