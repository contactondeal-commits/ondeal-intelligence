import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { CODER_VIEWPORTS } from "@/lib/ai/coder/types";

/**
 * ONDEAL AI CORE — PHASE 5 (suite) — §201 "multi-viewport natif" (06/09/2026).
 *
 * Verrouille le step `verify_and_fix` de buildCoderMissionSteps (steps.ts) :
 *   - CHAQUE tentative de vérification capture et fait réviser une capture
 *     d'écran RÉELLE à CHACUNE des largeurs de CODER_VIEWPORTS (desktop/
 *     tablet/mobile) — jamais une seule capture desktop supposée
 *     représentative du responsive (voir gauntlet/corpus.ts,
 *     "storefront_candidate_vs_production_before_after" : jusqu'ici cette
 *     largeur multiple n'existait que via un script ponctuel externe,
 *     jamais dans la boucle verify_and_fix elle-même).
 *   - Un artefact SCREENSHOT distinct par viewport, avec meta.viewport,
 *     est produit à CHAQUE tentative (succès ou échec) — jamais une preuve
 *     perdue.
 *   - Un verdict visuel négatif sur UN SEUL viewport suffit à faire échouer
 *     la tentative entière, et la raison rapportée NOMME ce viewport.
 *
 * Toutes les dépendances mécaniques/réseau (typecheck/lint/test/build,
 * navigateur Playwright, serveur de preview, Visual Reviewer) sont
 * mockées à la frontière du module — steps.ts est testé pour sa propre
 * logique d'orchestration multi-viewport, jamais pour l'exécution réelle
 * de ces sous-systèmes (déjà testés isolément ailleurs : coderOperations,
 * coderVision, coderWorkspace).
 */

vi.mock("@/lib/ai/coder/operations", () => ({
  runTypecheck: vi.fn(),
  runLint: vi.fn(),
  runTests: vi.fn(),
  runBuild: vi.fn(),
  editFile: vi.fn(),
  readFile: vi.fn(),
  getDiff: vi.fn(),
  searchCode: vi.fn(),
}));

vi.mock("@/lib/ai/coder/browser", () => ({
  openBrowser: vi.fn(),
  closeBrowser: vi.fn(),
  navigate: vi.fn(),
  click: vi.fn(),
  type: vi.fn(),
  scroll: vi.fn(),
  getVisibleText: vi.fn(),
  getDom: vi.fn(),
  getConsoleMessages: vi.fn(),
  getFailedRequests: vi.fn(),
  screenshot: vi.fn(),
  setViewport: vi.fn(),
}));

vi.mock("@/lib/ai/coder/preview", () => ({
  startPreviewServer: vi.fn(),
  stopPreviewServer: vi.fn(),
}));

vi.mock("@/lib/ai/coder/vision", () => ({
  reviewScreenshot: vi.fn(),
}));

vi.mock("@/lib/ai/coder/workspace", () => ({
  createMissionWorkspace: vi.fn(),
}));

vi.mock("@/lib/ai/models/router", () => ({
  chooseModel: vi.fn(),
}));

vi.mock("@/lib/ai/models/cost", () => ({
  estimateCostUsd: vi.fn(),
}));

import { buildCoderMissionSteps } from "@/lib/ai/coder/steps";
import * as operationsMod from "@/lib/ai/coder/operations";
import * as browserMod from "@/lib/ai/coder/browser";
import * as previewMod from "@/lib/ai/coder/preview";
import * as visionMod from "@/lib/ai/coder/vision";
import * as routerMod from "@/lib/ai/models/router";
import * as costMod from "@/lib/ai/models/cost";
import type { MissionSecurityBudget, MissionStepContext } from "@/lib/ai/coder/types";

const okOp = { ok: true, stdout: "", stderr: "", truncated: false, durationMs: 1, timedOut: false };

function makeContext(input: unknown): MissionStepContext {
  return {
    missionId: "m1",
    stepIndex: 4,
    attempt: 1,
    priorOutputs: [],
    input,
    cancelRequested: async () => false,
    heartbeat: async () => {},
  };
}

const fakeProvider = { name: "anthropic", capabilities: () => ({ maxContextTokens: 200_000, vision: true, toolUse: true, costPerMTokIn: 1, costPerMTokOut: 5 }), generate: vi.fn() };

const security: MissionSecurityBudget = {
  allowedPathPrefixes: ["src/app"],
  maxCostUsd: 5,
  maxFixIterations: 2,
  operationTimeoutMs: 30_000,
};

let workspaceRoot: string;

beforeEach(async () => {
  workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ondeal-coder-mv-"));

  (operationsMod.runTypecheck as Mock).mockResolvedValue(okOp);
  (operationsMod.runLint as Mock).mockResolvedValue(okOp);
  (operationsMod.runTests as Mock).mockResolvedValue(okOp);
  (operationsMod.runBuild as Mock).mockResolvedValue(okOp);
  (operationsMod.readFile as Mock).mockResolvedValue("// contenu actuel");
  (operationsMod.editFile as Mock).mockResolvedValue(undefined);

  (previewMod.startPreviewServer as Mock).mockResolvedValue({ process: {}, origin: "http://127.0.0.1:4600" });
  (previewMod.stopPreviewServer as Mock).mockImplementation(() => {});

  (browserMod.openBrowser as Mock).mockResolvedValue({ browser: {}, page: {}, consoleMessages: [], failedRequests: [] });
  (browserMod.closeBrowser as Mock).mockResolvedValue(undefined);
  (browserMod.getVisibleText as Mock).mockResolvedValue("texte visible");
  (browserMod.getConsoleMessages as Mock).mockReturnValue([]);
  (browserMod.getFailedRequests as Mock).mockReturnValue([]);
  (browserMod.setViewport as Mock).mockResolvedValue(undefined);
  (browserMod.screenshot as Mock).mockResolvedValue("ZmFrZS1wbmc=");

  (routerMod.chooseModel as Mock).mockResolvedValue({ model: "claude-fake", reason: "test" });
  (costMod.estimateCostUsd as Mock).mockReturnValue(0.001);
});

afterEach(async () => {
  vi.clearAllMocks();
  await fs.rm(workspaceRoot, { recursive: true, force: true });
});

function passingReview(viewport: string) {
  return { report: { overallPass: true, issues: [] }, provider: "anthropic", model: "claude-fake", costUsd: 0.0002, tokensIn: 10, tokensOut: 5 };
}

function failingReview(viewport: string) {
  return {
    report: { overallPass: false, issues: [{ description: `débordement horizontal (${viewport})`, severity: "high" as const, evidence: "capture", recommendedFix: "ajuster le CSS" }] },
    provider: "anthropic",
    model: "claude-fake",
    costUsd: 0.0002,
    tokensIn: 10,
    tokensOut: 5,
  };
}

describe("verify_and_fix — multi-viewport natif (§201)", () => {
  it("capture et fait réviser les 3 viewports (desktop/tablet/mobile) à chaque tentative réussie", async () => {
    (visionMod.reviewScreenshot as Mock)
      .mockResolvedValueOnce(passingReview("desktop"))
      .mockResolvedValueOnce(passingReview("tablet"))
      .mockResolvedValueOnce(passingReview("mobile"));

    const [, , , , verifyAndFix] = buildCoderMissionSteps(fakeProvider, {
      sourceRepoRoot: "/unused",
      security,
      previewPort: 4600,
      previewPath: "/settings",
      pageDescriptionForVision: "page settings",
    });

    const result = await verifyAndFix!.run(
      makeContext({ workspaceRoot, goal: "objectif", plan: { planDescription: "plan" }, editedFiles: ["src/app/settings/page.tsx"] }),
    );

    expect(CODER_VIEWPORTS.map((v) => v.name)).toEqual(["desktop", "tablet", "mobile"]);
    expect(browserMod.setViewport).toHaveBeenCalledTimes(3);
    for (const [i, vp] of CODER_VIEWPORTS.entries()) {
      expect((browserMod.setViewport as Mock).mock.calls[i]![1]).toEqual(vp);
    }
    expect(visionMod.reviewScreenshot).toHaveBeenCalledTimes(3);
    for (const [i, vp] of CODER_VIEWPORTS.entries()) {
      const call = (visionMod.reviewScreenshot as Mock).mock.calls[i]!;
      expect((call[2] as { pageDescription: string }).pageDescription).toContain(vp.name);
      expect((call[2] as { pageDescription: string }).pageDescription).toContain(String(vp.width));
    }

    const output = result.output as { success: boolean; criticReport: { overallPass: boolean; issues: unknown[] } };
    expect(output.success).toBe(true);
    expect(output.criticReport.overallPass).toBe(true);
    expect(output.criticReport.issues).toEqual([]);

    expect(result.artifacts).toHaveLength(3);
    expect(result.artifacts!.map((a) => (a.meta as { viewport: string }).viewport).sort()).toEqual(["desktop", "mobile", "tablet"]);
    for (const a of result.artifacts!) {
      expect(a.kind).toBe("SCREENSHOT");
      expect((a.meta as { finalAttempt: boolean }).finalAttempt).toBe(true);
    }
  });

  it("un verdict négatif sur UN SEUL viewport (mobile) fait échouer la tentative entière, et la raison nomme ce viewport — puis réussit après correction", async () => {
    (visionMod.reviewScreenshot as Mock)
      // Tentative 1 : desktop OK, tablet OK, mobile KO.
      .mockResolvedValueOnce(passingReview("desktop"))
      .mockResolvedValueOnce(passingReview("tablet"))
      .mockResolvedValueOnce(failingReview("mobile"))
      // Tentative 2 (après correction) : les 3 passent.
      .mockResolvedValueOnce(passingReview("desktop"))
      .mockResolvedValueOnce(passingReview("tablet"))
      .mockResolvedValueOnce(passingReview("mobile"));

    (fakeProvider.generate as Mock).mockResolvedValue({
      text: JSON.stringify({ files: [{ path: "src/app/settings/page.tsx", content: "// corrigé" }] }),
      citations: [],
      tokensIn: 50,
      tokensOut: 20,
    });

    const [, , , , verifyAndFix] = buildCoderMissionSteps(fakeProvider, {
      sourceRepoRoot: "/unused",
      security,
      previewPort: 4600,
      previewPath: "/settings",
      pageDescriptionForVision: "page settings",
    });

    const result = await verifyAndFix!.run(
      makeContext({ workspaceRoot, goal: "objectif", plan: { planDescription: "plan" }, editedFiles: ["src/app/settings/page.tsx"] }),
    );

    expect(visionMod.reviewScreenshot).toHaveBeenCalledTimes(6); // 3 viewports × 2 tentatives
    const output = result.output as { success: boolean; iterations: Array<{ attempt: number; ok: boolean; reason?: string }> };
    expect(output.success).toBe(true);
    expect(output.iterations).toHaveLength(2);
    expect(output.iterations[0]!.ok).toBe(false);
    expect(output.iterations[0]!.reason).toContain("[mobile]");
    expect(output.iterations[0]!.reason).not.toContain("[desktop]");
    expect(output.iterations[1]!.ok).toBe(true);

    // 3 captures de la tentative échouée (preuve conservée) + 3 de la tentative réussie.
    expect(result.artifacts).toHaveLength(6);
    const attempt1Artifacts = result.artifacts!.filter((a) => (a.meta as { attempt: number }).attempt === 1);
    expect(attempt1Artifacts).toHaveLength(3);
    expect(attempt1Artifacts.every((a) => (a.meta as { finalAttempt: boolean }).finalAttempt === false)).toBe(true);
    const attempt2Artifacts = result.artifacts!.filter((a) => (a.meta as { attempt: number }).attempt === 2);
    expect(attempt2Artifacts).toHaveLength(3);
    expect(attempt2Artifacts.every((a) => (a.meta as { finalAttempt: boolean }).finalAttempt === true)).toBe(true);
  });

  it("un échec mécanique (build) empêche TOUTE capture de viewport — jamais une preuve visuelle après un échec mécanique", async () => {
    (operationsMod.runBuild as Mock).mockResolvedValue({ ...okOp, ok: false, stderr: "erreur de build" });

    const [, , , , verifyAndFix] = buildCoderMissionSteps(fakeProvider, {
      sourceRepoRoot: "/unused",
      security: { ...security, maxFixIterations: 0 },
      previewPort: 4600,
      previewPath: "/settings",
      pageDescriptionForVision: "page settings",
    });

    await expect(
      verifyAndFix!.run(makeContext({ workspaceRoot, goal: "objectif", plan: { planDescription: "plan" }, editedFiles: ["src/app/settings/page.tsx"] })),
    ).rejects.toThrow(/build a échoué/);

    expect(browserMod.openBrowser).not.toHaveBeenCalled();
    expect(visionMod.reviewScreenshot).not.toHaveBeenCalled();
    expect(browserMod.setViewport).not.toHaveBeenCalled();
  });
});
