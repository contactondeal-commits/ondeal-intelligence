import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ONDEAL AI CORE — PHASE 5 : tests du Policy Engine (06/09/2026), §12/§17.
 *
 * Un magasin en mémoire remplace `prisma.systemPolicy` — même principe que
 * les autres tests de ce dépôt (aucune base réelle ici). Teste le VRAI
 * comportement de décision (jamais un ALLOW_AUTO implicite pour un risque
 * non couvert, jamais un Kill Switch qui n'arrête pas réellement).
 */

const fakeDb = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    systemPolicy: {
      upsert: async ({ create, update }: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
        if (!fakeDb.row) fakeDb.row = { ...create };
        else fakeDb.row = { ...fakeDb.row, ...update };
        return fakeDb.row;
      },
    },
  },
}));

import { evaluatePolicy, getSystemPolicy, setSystemPolicy } from "@/lib/ai/policy/engine";

beforeEach(() => {
  fakeDb.row = null;
});

describe("Policy Engine (§12/§17 NO FAKE CONTROL)", () => {
  it("crée le singleton avec les valeurs par défaut LES PLUS RESTRICTIVES (jamais permissives) s'il n'existe pas encore", async () => {
    const policy = await getSystemPolicy();
    expect(policy.killSwitchEngaged).toBe(false);
    expect(policy.productionEffectsAllowed).toBe(false); // §8 : jamais activé par défaut
    expect(policy.maxHardBudgetUsdGlobal).toBe(20);
  });

  it("Kill Switch engagé => DENY pour TOUTE classe de risque, y compris COGNITION (§3/§17 : arrêt réel, pas décoratif)", async () => {
    await setSystemPolicy({ killSwitchEngaged: true, killSwitchReason: "Test d'urgence" }, "owner-1");
    const result = await evaluatePolicy({ autonomyLevel: "ULTIMATE", environment: "SANDBOX", riskClass: "COGNITION", currentCostUsd: 0, hardBudgetUsd: null });
    expect(result.decision).toBe("DENY");
    expect(result.reason).toContain("Kill switch");
  });

  it("COGNITION est toujours ALLOW_AUTO hors Kill Switch/budget (§7 MAXIMUM COGNITION)", async () => {
    const result = await evaluatePolicy({ autonomyLevel: "ASSIST", environment: "SANDBOX", riskClass: "COGNITION", currentCostUsd: 0, hardBudgetUsd: null });
    expect(result.decision).toBe("ALLOW_AUTO");
  });

  it("SANDBOX_EFFECT est ALLOW_AUTO en environnement SANDBOX même en niveau ASSIST (§7 SANDBOX FREEDOM)", async () => {
    const result = await evaluatePolicy({ autonomyLevel: "ASSIST", environment: "SANDBOX", riskClass: "SANDBOX_EFFECT", currentCostUsd: 0, hardBudgetUsd: null });
    expect(result.decision).toBe("ALLOW_AUTO");
  });

  it("SANDBOX_EFFECT est DENY hors environnement SANDBOX (§8 : effecteurs jamais autorisés implicitement ailleurs)", async () => {
    const result = await evaluatePolicy({ autonomyLevel: "ULTIMATE", environment: "PREVIEW", riskClass: "SANDBOX_EFFECT", currentCostUsd: 0, hardBudgetUsd: null });
    expect(result.decision).toBe("DENY");
  });

  it("EXTERNAL_WRITE n'est JAMAIS ALLOW_AUTO, même en ULTIMATE (§6/§15 : l'autonomie ne change jamais le périmètre)", async () => {
    const result = await evaluatePolicy({ autonomyLevel: "ULTIMATE", environment: "SANDBOX", riskClass: "EXTERNAL_WRITE", currentCostUsd: 0, hardBudgetUsd: null });
    expect(result.decision).toBe("REQUIRE_APPROVAL");
  });

  it("PRODUCTION_EFFECT est DENY tant que productionEffectsAllowed=false, quel que soit le niveau d'autonomie", async () => {
    const result = await evaluatePolicy({ autonomyLevel: "ULTIMATE", environment: "PRODUCTION", riskClass: "PRODUCTION_EFFECT", currentCostUsd: 0, hardBudgetUsd: null });
    expect(result.decision).toBe("DENY");
  });

  it("PRODUCTION_EFFECT reste REQUIRE_APPROVAL (jamais ALLOW_AUTO) même une fois productionEffectsAllowed=true (§8 : effecteurs toujours Owner-controlled)", async () => {
    await setSystemPolicy({ productionEffectsAllowed: true }, "owner-1");
    const result = await evaluatePolicy({ autonomyLevel: "ULTIMATE", environment: "PRODUCTION", riskClass: "PRODUCTION_EFFECT", currentCostUsd: 0, hardBudgetUsd: null });
    expect(result.decision).toBe("REQUIRE_APPROVAL");
  });

  it("budget dur de mission dépassé => DENY, jamais un dépassement silencieux", async () => {
    const result = await evaluatePolicy({ autonomyLevel: "ULTIMATE", environment: "SANDBOX", riskClass: "COGNITION", currentCostUsd: 5.5, hardBudgetUsd: 5 });
    expect(result.decision).toBe("DENY");
    expect(result.reason).toContain("Budget dur");
  });

  it("plafond ABSOLU du système dépassé => DENY même sans hardBudgetUsd de mission (filet de sécurité Owner non contournable)", async () => {
    const result = await evaluatePolicy({ autonomyLevel: "ULTIMATE", environment: "SANDBOX", riskClass: "COGNITION", currentCostUsd: 25, hardBudgetUsd: null });
    expect(result.decision).toBe("DENY");
    expect(result.reason).toContain("Plafond ABSOLU");
  });

  it("EXTERNAL_READ requiert une approbation en ASSIST mais pas au-delà (Owner garde la main sur la première utilisation d'un connecteur)", async () => {
    const assist = await evaluatePolicy({ autonomyLevel: "ASSIST", environment: "SANDBOX", riskClass: "EXTERNAL_READ", currentCostUsd: 0, hardBudgetUsd: null });
    expect(assist.decision).toBe("REQUIRE_APPROVAL");
    const autonomous = await evaluatePolicy({ autonomyLevel: "AUTONOMOUS", environment: "SANDBOX", riskClass: "EXTERNAL_READ", currentCostUsd: 0, hardBudgetUsd: null });
    expect(autonomous.decision).toBe("ALLOW_AUTO");
  });
});
