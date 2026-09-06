import { afterEach, describe, expect, it, vi } from "vitest";
import { reviewScreenshot } from "@/lib/ai/coder/vision";

/**
 * ONDEAL AI CORE — PHASE 3 : tests du Visual Reviewer / Critic (06/09/2026).
 * Vérifie que la sortie est STRICTEMENT structurée (zod) — jamais un
 * verdict inventé quand le modèle répond mal — et que le Router (PHASE 2,
 * chooseModel) est réellement consulté plutôt qu'un modèle forcé en dur.
 * Aucune vraie base ni vrai réseau ici — le provider est un double de test
 * (voir convention tests/jobsMarginRisk.test.ts) ; "@/lib/db" est mocké
 * (aucune évaluation persistée) pour que chooseModel retombe explicitement
 * sur DEFAULT_MODEL (voir tests/modelRouter.test.ts pour ce comportement
 * testé isolément).
 */

vi.mock("@/lib/db", () => ({
  prisma: {
    modelEvalRun: { findMany: vi.fn().mockResolvedValue([]) },
    modelEvalResult: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

afterEach(() => {
  // vi.restoreAllMocks() effacerait aussi l'implémentation mockResolvedValue()
  // du mock "@/lib/db" ci-dessus (comportement vitest pour un vi.fn() non
  // issu d'un spy) — clearAllMocks() suffit ici (seul l'historique d'appels
  // compte entre les tests, chaque test fournit son propre provider double).
  vi.clearAllMocks();
});

function fakeProvider(generateText: string, vision = true) {
  return {
    name: "anthropic",
    capabilities: () => ({ maxContextTokens: 200_000, vision, toolUse: true, costPerMTokIn: 1, costPerMTokOut: 5 }),
    generate: vi.fn().mockResolvedValue({ text: generateText, citations: [], tokensIn: 100, tokensOut: 50 }),
  };
}

describe("reviewScreenshot — sortie structurée uniquement", () => {
  it("parse un rapport JSON valide et calcule un coût réel", async () => {
    const provider = fakeProvider(JSON.stringify({ overallPass: true, issues: [] }));
    const result = await reviewScreenshot(provider, "ZmFrZS1wbmc=", { pageDescription: "page de test" });
    expect(result.report).toEqual({ overallPass: true, issues: [] });
    expect(result.costUsd).toBeCloseTo((100 * 1 + 50 * 5) / 1_000_000, 9);
    expect(provider.generate).toHaveBeenCalledWith(
      expect.objectContaining({ images: [{ mediaType: "image/png", data: "ZmFrZS1wbmc=" }] }),
    );
  });

  it("accepte un JSON entouré de balises markdown", async () => {
    const provider = fakeProvider("```json\n" + JSON.stringify({ overallPass: false, issues: [{ description: "d", severity: "high", evidence: "e", recommendedFix: "f" }] }) + "\n```");
    const result = await reviewScreenshot(provider, "ZmFrZQ==", { pageDescription: "x" });
    expect(result.report.overallPass).toBe(false);
    expect(result.report.issues).toHaveLength(1);
  });

  it("refuse (lève) plutôt que d'inventer un verdict quand la sortie n'est pas un JSON valide", async () => {
    const provider = fakeProvider("ceci n'est pas du JSON du tout");
    await expect(reviewScreenshot(provider, "ZmFrZQ==", { pageDescription: "x" })).rejects.toThrow(/JSON valide/);
  });

  it("refuse (lève) quand le JSON ne respecte pas le format attendu (severity invalide)", async () => {
    const provider = fakeProvider(JSON.stringify({ overallPass: true, issues: [{ description: "d", severity: "catastrophic", evidence: "e", recommendedFix: "f" }] }));
    await expect(reviewScreenshot(provider, "ZmFrZQ==", { pageDescription: "x" })).rejects.toThrow(/non conforme/);
  });

  it("refuse d'appeler un modèle sans capacité vision, même choisi par le Router", async () => {
    const provider = fakeProvider(JSON.stringify({ overallPass: true, issues: [] }), false);
    await expect(reviewScreenshot(provider, "ZmFrZQ==", { pageDescription: "x" })).rejects.toThrow(/vision/);
    expect(provider.generate).not.toHaveBeenCalled();
  });
});
