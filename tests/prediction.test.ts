import { describe, it, expect } from "vitest";
import {
  buildPricePrediction,
  isPricePrediction,
  measurePriceOutcome,
  assessDeferredMeasurement,
  isDeferredWindowElapsed,
  pendingWindowMeasurement,
  DEFERRED_WINDOW_DAYS,
  DEFERRED_MIN_UNITS_PER_WINDOW,
} from "@/lib/intelligence/prediction";
import type { ResolvedCostInputs } from "@/lib/intelligence/costs";

// Variante réelle de la boutique (Military Tactical Dog Harness — Red / M) :
// prix 109.98 €, coût réel Shopify 87.98 €, aucune hypothèse de frais.
const COSTS_REAL_NO_ASSUMPTIONS: ResolvedCostInputs = {
  supplierCost: 87.98,
  supplierCostSource: "shopify_unit_cost",
  shippingCost: null,
  shippingCostSource: "unavailable",
  paymentFeesRate: null,
  paymentFeesRateSource: "unavailable",
  otherFixedCost: null,
  otherFixedCostSource: "unavailable",
};

describe("buildPricePrediction — ce qu'OnDeal pensait qu'il allait se passer", () => {
  it("persiste prix avant, coût et sa source, marge brute avant/après, deltas et horodatage", () => {
    const p = buildPricePrediction({
      variantId: "v1", productId: "p1", currentPrice: 109.98, newPrice: 119.98,
      costs: COSTS_REAL_NO_ASSUMPTIONS, now: new Date("2026-09-03T22:00:00Z"),
    });
    expect(isPricePrediction(p)).toBe(true);
    expect(p.predictedAt).toBe("2026-09-03T22:00:00.000Z");
    expect(p.priceBefore).toBe(109.98);
    expect(p.newPrice).toBe(119.98);
    expect(p.supplierCost).toBe(87.98);
    expect(p.supplierCostSource).toBe("shopify_unit_cost");
    expect(p.grossMarginBefore).toBeCloseTo(22, 2);
    expect(p.grossMarginAfter).toBeCloseTo(32, 2);
    expect(p.deltaPrice).toBeCloseTo(10, 2);
    expect(p.deltaGrossMargin).toBeCloseTo(10, 2);
    expect(p.deltaGrossMarginPct).toBeCloseTo(10 / 22, 4);
  });

  it("dit explicitement ce qui n'est PAS prédit : ventes, CA, et marge complète si les hypothèses manquent", () => {
    const p = buildPricePrediction({ variantId: "v1", productId: "p1", currentPrice: 109.98, newPrice: 119.98, costs: COSTS_REAL_NO_ASSUMPTIONS });
    expect(p.marginAfter).toBeNull();
    expect(p.notPredicted.some((n) => n.includes("volume de ventes"))).toBe(true);
    expect(p.notPredicted.some((n) => n.includes("marge complète"))).toBe(true);
    expect(p.assumptions.shippingCostSource).toBe("unavailable");
  });

  it("inclut la marge complète prédite quand les hypothèses boutique existent, en les étiquetant", () => {
    const costs: ResolvedCostInputs = { ...COSTS_REAL_NO_ASSUMPTIONS, shippingCost: 4.5, shippingCostSource: "store_default", paymentFeesRate: 0.029, paymentFeesRateSource: "store_default" };
    const p = buildPricePrediction({ variantId: "v1", productId: "p1", currentPrice: 109.98, newPrice: 119.98, costs });
    expect(p.marginAfter).toBeCloseTo(119.98 - 87.98 - 4.5 - 119.98 * 0.029, 2);
    expect(p.assumptions.shippingCostSource).toBe("store_default");
    expect(p.notPredicted.some((n) => n.includes("marge complète"))).toBe(false);
  });

  it("le type guard rejette un payload sans prédiction (ActionItem antérieure au slice)", () => {
    expect(isPricePrediction(undefined)).toBe(false);
    expect(isPricePrediction({ newPrice: 10 })).toBe(false);
  });
});

describe("measurePriceOutcome — PREDICTION → RESULT → GAP structurel", () => {
  const prediction = buildPricePrediction({ variantId: "v1", productId: "p1", currentPrice: 109.98, newPrice: 119.98, costs: COSTS_REAL_NO_ASSUMPTIONS });

  it("résultat conforme : prix relu de Shopify et coût réel inchangés → écart nul, structuralMatch", () => {
    const m = measurePriceOutcome({ prediction, appliedPrice: 119.98, supplierCost: 87.98, supplierCostSource: "shopify_unit_cost" });
    expect(m.gap.price).toBeCloseTo(0, 2);
    expect(m.gap.grossMargin).toBeCloseTo(0, 2);
    expect(m.gap.structuralMatch).toBe(true);
    expect(m.observed.grossMargin).toBeCloseTo(32, 2);
  });

  it("écart détecté si Shopify a arrondi le prix ou si le coût réel a changé depuis la prédiction", () => {
    const m = measurePriceOutcome({ prediction, appliedPrice: 120, supplierCost: 90, supplierCostSource: "shopify_unit_cost" });
    expect(m.gap.structuralMatch).toBe(false);
    expect(m.gap.price).toBeCloseTo(0.02, 2);
    expect(m.gap.grossMargin).toBeCloseTo(30 - 32, 2);
    expect(m.gap.explanation).toContain("120.00");
  });

  it("la mesure commerciale différée est toujours « données insuffisantes » à l'exécution — jamais une tendance inventée", () => {
    const m = measurePriceOutcome({ prediction, appliedPrice: 119.98, supplierCost: 87.98, supplierCostSource: "shopify_unit_cost" });
    expect(m.deferred.status).toBe("insufficient_data");
    expect(m.deferred.reason).toContain("Données insuffisantes");
  });
});

describe("assessDeferredMeasurement — seuil statistique minimal avant toute comparaison", () => {
  it("insuffisant tant qu'une des fenêtres est sous le seuil (ex. 1 vente sur 14 jours)", () => {
    expect(assessDeferredMeasurement({ unitsBefore: 1, unitsAfter: 0 }).status).toBe("insufficient_data");
    expect(assessDeferredMeasurement({ unitsBefore: 40, unitsAfter: 12 }).status).toBe("insufficient_data");
    expect(assessDeferredMeasurement({ unitsBefore: null, unitsAfter: null }).status).toBe("insufficient_data");
  });

  it("disponible seulement quand les deux fenêtres atteignent le seuil", () => {
    const r = assessDeferredMeasurement({ unitsBefore: 35, unitsAfter: 31 });
    expect(r.status).toBe("available");
  });
});

describe("isDeferredWindowElapsed — a-t-on seulement laissé le temps aux vraies commandes d'arriver ?", () => {
  const executedAt = new Date("2026-08-01T00:00:00Z");

  it("faux tant que la fenêtre n'est pas écoulée", () => {
    expect(isDeferredWindowElapsed(executedAt, 14, new Date("2026-08-10T00:00:00Z"))).toBe(false);
  });

  it("vrai pile à l'échéance et au-delà", () => {
    expect(isDeferredWindowElapsed(executedAt, 14, new Date("2026-08-15T00:00:00Z"))).toBe(true);
    expect(isDeferredWindowElapsed(executedAt, 14, new Date("2026-09-01T00:00:00Z"))).toBe(true);
  });
});

describe("pendingWindowMeasurement — message honnête quand la fenêtre n'est pas encore écoulée", () => {
  it("reste insufficient_data, sans avant/après inventés, et compte les jours réellement écoulés", () => {
    const executedAt = new Date("2026-08-01T00:00:00Z");
    const now = new Date("2026-08-08T00:00:00Z");
    const r = pendingWindowMeasurement(executedAt, DEFERRED_WINDOW_DAYS, DEFERRED_MIN_UNITS_PER_WINDOW, now);
    expect(r.status).toBe("insufficient_data");
    expect(r.unitsBefore).toBeNull();
    expect(r.unitsAfter).toBeNull();
    expect(r.windowDays).toBe(DEFERRED_WINDOW_DAYS);
    expect(r.minUnitsPerWindow).toBe(DEFERRED_MIN_UNITS_PER_WINDOW);
    expect(r.reason).toContain("7/14");
    expect(r.reason).toContain("15/08/2026");
  });

  it("n'affiche jamais un compte de jours négatif si now précède executedAt", () => {
    const executedAt = new Date("2026-08-01T00:00:00Z");
    const now = new Date("2026-07-30T00:00:00Z");
    const r = pendingWindowMeasurement(executedAt, 14, 30, now);
    expect(r.reason).toContain("0/14");
  });
});
