import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ONDEAL AI JOB ENGINE — PHASE 1 vertical slice réel : "analyze_margin_risk"
 * (06/09/2026).
 *
 * Convention de mock alignée sur tests/stockBulkUpdateRoute.test.ts :
 * vi.doMock + vi.resetModules() + import dynamique dans chaque test, pour
 * que chaque test reçoive des mocks indépendants.
 *
 * Ce que ces tests verrouillent, EXACTEMENT dans l'esprit "no partial
 * theater" :
 *   - collectMarginEvidence n'utilise QUE analyzeMargin/resolveCostInputs
 *     RÉELS (aucune réimplémentation du calcul de marge) et exclut toute
 *     variante dont la marge brute n'est pas réellement calculable.
 *   - Le step de raisonnement n'appelle JAMAIS le modèle si l'évidence est
 *     vide (coût zéro garanti).
 *   - Le step de vérification REJETTE (fait échouer le step, jamais un
 *     succès silencieux) toute recommandation qui invente un variantId ou
 *     en duplique un — l'ancrage à la donnée réelle est mécaniquement
 *     imposé, pas seulement documenté.
 */

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

type MockVariant = {
  id: string;
  title: string;
  price: number | null;
  unitCost: number | null;
};
type MockProduct = {
  id: string;
  title: string;
  variants: MockVariant[];
  costAssumption: { supplierCost: number | null; shippingCost: number | null; paymentFeesRate: number | null; otherFixedCost: number | null } | null;
};

async function loadMarginRisk(opts: {
  storeDefaults?: { defaultShippingCost: number | null; defaultPaymentFeesRate: number | null } | null;
  products?: MockProduct[];
  generate?: ReturnType<typeof vi.fn>;
}) {
  vi.resetModules();

  vi.doMock("@/lib/db", () => ({
    prisma: {
      store: { findUnique: vi.fn().mockResolvedValue(opts.storeDefaults ?? { defaultShippingCost: null, defaultPaymentFeesRate: null }) },
      product: { findMany: vi.fn().mockResolvedValue(opts.products ?? []) },
    },
  }));

  if (opts.generate) {
    vi.doMock("@/lib/ai/providers/anthropic", () => ({
      AnthropicProvider: class {
        name = "anthropic";
        generate = opts.generate;
      },
    }));
  }

  return import("@/lib/ai/jobs/tasks/marginRisk");
}

function makeCtx(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    jobId: "job1",
    storeId: "store1",
    stepIndex: 0,
    attempt: 1,
    priorOutputs: [] as unknown[],
    input: null,
    cancelRequested: async () => false,
    heartbeat: async () => {},
    ...overrides,
  };
}

describe("collectMarginEvidence — TOOL EXECUTION sur donnée boutique réelle", () => {
  it("ne retient que les variantes dont la marge brute est réellement calculable (coût réel ou repli explicite)", async () => {
    const products: MockProduct[] = [
      {
        id: "p1",
        title: "Harnais",
        variants: [
          { id: "v1", title: "M", price: 100, unitCost: 80 }, // coût réel Shopify — calculable
          { id: "v2", title: "L", price: 50, unitCost: null }, // aucun coût nulle part — indisponible
        ],
        costAssumption: null,
      },
      {
        id: "p2",
        title: "Laisse",
        variants: [{ id: "v3", title: "Unique", price: 20, unitCost: null }], // repli CostAssumption
        costAssumption: { supplierCost: 12, shippingCost: null, paymentFeesRate: null, otherFixedCost: null },
      },
    ];
    const { collectMarginEvidence } = await loadMarginRisk({ products });
    const evidence = await collectMarginEvidence("store1", 20);

    expect(evidence.totalVariantsConsidered).toBe(3);
    expect(evidence.totalWithComputableGrossMargin).toBe(2);
    expect(evidence.rows.map((r) => r.variantId).sort()).toEqual(["v1", "v3"]);
    const v3 = evidence.rows.find((r) => r.variantId === "v3");
    expect(v3?.supplierCostSource).toBe("cost_assumption");
    expect(v3?.grossMargin).toBe(8); // 20 - 12
  });

  it("trie par marge brute (taux) croissante — le risque le plus élevé en premier", async () => {
    const products: MockProduct[] = [
      {
        id: "p1",
        title: "A",
        variants: [
          { id: "high", title: "x", price: 100, unitCost: 20 }, // marge 80%
          { id: "low", title: "x", price: 100, unitCost: 95 }, // marge 5%
        ],
        costAssumption: null,
      },
    ];
    const { collectMarginEvidence } = await loadMarginRisk({ products });
    const evidence = await collectMarginEvidence("store1", 20);
    expect(evidence.rows.map((r) => r.variantId)).toEqual(["low", "high"]);
  });

  it("respecte la limite demandée (plafonnée à MAX_MARGIN_RISK_LIMIT)", async () => {
    const products: MockProduct[] = [
      {
        id: "p1",
        title: "A",
        variants: Array.from({ length: 10 }, (_, i) => ({ id: `v${i}`, title: "x", price: 100, unitCost: 50 + i })),
        costAssumption: null,
      },
    ];
    const { collectMarginEvidence } = await loadMarginRisk({ products });
    const evidence = await collectMarginEvidence("store1", 3);
    expect(evidence.rows).toHaveLength(3);
    expect(evidence.totalWithComputableGrossMargin).toBe(10);
  });
});

describe("reason_margin_risk — MODEL REASONING WHEN NEEDED", () => {
  it("ne fait AUCUN appel modèle si l'évidence est vide (coût zéro garanti)", async () => {
    const generate = vi.fn();
    const { reasonStep } = await loadMarginRisk({ generate });
    const ctx = makeCtx({ priorOutputs: [{ storeId: "s1", generatedAt: "t", totalVariantsConsidered: 0, totalWithComputableGrossMargin: 0, rows: [] }] });
    const result = await reasonStep.run(ctx as never);
    expect(generate).not.toHaveBeenCalled();
    expect(result.output).toEqual({ recommendations: [] });
  });

  it("valide la sortie JSON du modèle et rejette un format non conforme", async () => {
    const generate = vi.fn().mockResolvedValue({ text: "ceci n'est pas du JSON", citations: [], tokensIn: 10, tokensOut: 5 });
    const { reasonStep } = await loadMarginRisk({ generate });
    const evidence = { storeId: "s1", generatedAt: "t", totalVariantsConsidered: 1, totalWithComputableGrossMargin: 1, rows: [{ variantId: "v1", productId: "p1", title: "x", sellingPrice: 10, supplierCost: 9, supplierCostSource: "shopify_unit_cost" as const, grossMargin: 1, grossMarginRate: 0.1 }] };
    const ctx = makeCtx({ priorOutputs: [evidence] });
    await expect(reasonStep.run(ctx as never)).rejects.toThrow(/JSON/);
  });

  it("accepte une réponse JSON valide, y compris entourée d'un bloc ```json``` ", async () => {
    const evidence = { storeId: "s1", generatedAt: "t", totalVariantsConsidered: 1, totalWithComputableGrossMargin: 1, rows: [{ variantId: "v1", productId: "p1", title: "x", sellingPrice: 10, supplierCost: 9, supplierCostSource: "shopify_unit_cost" as const, grossMargin: 1, grossMarginRate: 0.1 }] };
    const generate = vi.fn().mockResolvedValue({
      text: '```json\n{"recommendations":[{"variantId":"v1","priority":1,"rationale":"Marge très faible."}]}\n```',
      citations: [],
      tokensIn: 42,
      tokensOut: 17,
    });
    const { reasonStep } = await loadMarginRisk({ generate });
    const ctx = makeCtx({ priorOutputs: [evidence] });
    const result = await reasonStep.run(ctx as never);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(result.output).toEqual({ recommendations: [{ variantId: "v1", priority: 1, rationale: "Marge très faible." }] });
    expect(result.provider).toBe("anthropic");
    expect(result.tokensIn).toBe(42);
  });
});

describe("verify_margin_risk_grounding — VERIFICATION, no partial theater", () => {
  const evidence = {
    storeId: "s1",
    generatedAt: "t",
    totalVariantsConsidered: 1,
    totalWithComputableGrossMargin: 1,
    rows: [{ variantId: "v1", productId: "p1", title: "x", sellingPrice: 10, supplierCost: 9, supplierCostSource: "shopify_unit_cost" as const, grossMargin: 1, grossMarginRate: 0.1 }],
  };

  it("rejette une recommandation qui référence un variantId absent de l'évidence réelle (hallucination)", async () => {
    const { verifyStep } = await loadMarginRisk({});
    const ctx = makeCtx({ priorOutputs: [evidence, { recommendations: [{ variantId: "invente-123", priority: 1, rationale: "x" }] }] });
    await expect(verifyStep.run(ctx as never)).rejects.toThrow(/absent de l'évidence/);
  });

  it("rejette un variantId recommandé plus d'une fois", async () => {
    const { verifyStep } = await loadMarginRisk({});
    const ctx = makeCtx({
      priorOutputs: [
        evidence,
        { recommendations: [{ variantId: "v1", priority: 1, rationale: "x" }, { variantId: "v1", priority: 2, rationale: "y" }] },
      ],
    });
    await expect(verifyStep.run(ctx as never)).rejects.toThrow(/plus d'une fois/);
  });

  it("laisse passer une recommandation correctement ancrée et produit le résultat structuré final", async () => {
    const { verifyStep } = await loadMarginRisk({});
    const ctx = makeCtx({ priorOutputs: [evidence, { recommendations: [{ variantId: "v1", priority: 1, rationale: "Marge très faible." }] }] });
    const result = await verifyStep.run(ctx as never);
    expect(result.output).toEqual({
      storeId: "s1",
      generatedAt: "t",
      evidenceCount: 1,
      recommendations: [{ variantId: "v1", priority: 1, rationale: "Marge très faible." }],
    });
  });
});
