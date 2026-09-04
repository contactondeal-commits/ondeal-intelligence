import { describe, it, expect } from "vitest";
import { resolveCostInputs } from "@/lib/intelligence/costs";
import { analyzeMargin } from "@/lib/intelligence/margin";
import { simulatePriceChange } from "@/lib/intelligence/simulate";

describe("resolveCostInputs — source de vérité du coût", () => {
  it("le coût réel Shopify (unitCost) est prioritaire sur l'hypothèse OnDeal", () => {
    const r = resolveCostInputs({ unitCost: 87.98 }, { supplierCost: 60, shippingCost: null, paymentFeesRate: null, otherFixedCost: null }, null);
    expect(r.supplierCost).toBe(87.98);
    expect(r.supplierCostSource).toBe("shopify_unit_cost");
  });

  it("l'hypothèse OnDeal n'est utilisée qu'en repli explicite quand Shopify ne fournit rien", () => {
    const r = resolveCostInputs({ unitCost: null }, { supplierCost: 60, shippingCost: null, paymentFeesRate: null, otherFixedCost: null }, null);
    expect(r.supplierCost).toBe(60);
    expect(r.supplierCostSource).toBe("cost_assumption");
  });

  it("sans coût réel ni repli, le coût reste null et indisponible — jamais inventé", () => {
    const r = resolveCostInputs({ unitCost: null }, null, null);
    expect(r.supplierCost).toBeNull();
    expect(r.supplierCostSource).toBe("unavailable");
  });

  it("transport et frais : hypothèse produit d'abord, hypothèse boutique ensuite, sinon indisponible", () => {
    const store = { defaultShippingCost: 4.5, defaultPaymentFeesRate: 0.029 };
    const withProduct = resolveCostInputs({ unitCost: 10 }, { supplierCost: null, shippingCost: 2, paymentFeesRate: null, otherFixedCost: null }, store);
    expect(withProduct.shippingCost).toBe(2);
    expect(withProduct.shippingCostSource).toBe("product_assumption");
    expect(withProduct.paymentFeesRate).toBe(0.029);
    expect(withProduct.paymentFeesRateSource).toBe("store_default");
    const none = resolveCostInputs({ unitCost: 10 }, null, null);
    expect(none.shippingCost).toBeNull();
    expect(none.shippingCostSource).toBe("unavailable");
  });
});

describe("analyzeMargin — marge brute (réelle) vs marge complète (hypothèses)", () => {
  const base = { productId: "p", variantId: "v", title: "Harness", sellingPrice: 109.98, supplierCost: 87.98, supplierCostSource: "shopify_unit_cost" as const };

  it("calcule la marge brute dès que prix et coût réel sont connus, sans hypothèse", () => {
    const m = analyzeMargin({ ...base, shippingCost: null, paymentFeesRate: null, otherFixedCost: null });
    expect(m.grossMargin).toBeCloseTo(22, 2);
    expect(m.grossMarginRate).toBeCloseTo(0.2, 3);
    expect(m.margin).toBeNull(); // marge complète non calculable sans transport/frais
    expect(m.status.sellingPrice).toBe("real");
    expect(m.status.supplierCost).toBe("real");
    expect(m.status.grossMargin).toBe("calculated");
    expect(m.status.margin).toBe("unavailable");
    expect(m.status.shippingCost).toBe("unavailable");
  });

  it("étiquette transport et frais comme estimés et la marge complète comme calculée quand ils sont renseignés", () => {
    const m = analyzeMargin({ ...base, shippingCost: 4.5, paymentFeesRate: 0.029, otherFixedCost: null });
    expect(m.status.shippingCost).toBe("estimated");
    expect(m.status.paymentFees).toBe("estimated");
    expect(m.status.margin).toBe("calculated");
    expect(m.margin).toBeCloseTo(109.98 - 87.98 - 4.5 - 109.98 * 0.029, 2);
  });

  it("un coût issu d'une hypothèse OnDeal est étiqueté estimé, jamais réel", () => {
    const m = analyzeMargin({ ...base, supplierCostSource: "cost_assumption", shippingCost: null, paymentFeesRate: null, otherFixedCost: null });
    expect(m.status.supplierCost).toBe("estimated");
    expect(m.supplierCostSource).toBe("cost_assumption");
  });

  it("sans coût, marge brute et marge complète sont indisponibles (jamais 0)", () => {
    const m = analyzeMargin({ ...base, supplierCost: null, supplierCostSource: "unavailable", shippingCost: 4.5, paymentFeesRate: 0.029, otherFixedCost: null });
    expect(m.grossMargin).toBeNull();
    expect(m.margin).toBeNull();
    expect(m.status.supplierCost).toBe("unavailable");
  });
});

describe("simulatePriceChange — simulation sur marge brute quand les hypothèses manquent", () => {
  it("reste disponible sur la marge brute et explique pourquoi la marge complète ne l'est pas", () => {
    const r = simulatePriceChange({
      productId: "p", variantId: "v", title: "Harness",
      currentPrice: 109.98, supplierCost: 87.98, supplierCostSource: "shopify_unit_cost",
      shippingCost: null, paymentFeesRate: null, otherFixedCost: null, candidatePrice: 119.98,
    });
    expect(r.available).toBe(true);
    if (r.available) {
      expect(r.fullMarginAvailable).toBe(false);
      expect(r.fullMarginUnavailableReason).toContain("transport");
      expect(r.deltaGrossMargin).toBeCloseTo(10, 2);
      expect(r.deltaMargin).toBeNull();
      expect(r.after.grossMargin).toBeCloseTo(32, 2);
    }
  });

  it("ANALYSE = SIMULATION : la marge brute simulée est exactement celle d'analyzeMargin au prix candidat", () => {
    const input = { productId: "p", variantId: "v", title: "X", supplierCost: 7.54, supplierCostSource: "shopify_unit_cost" as const, shippingCost: null, paymentFeesRate: null, otherFixedCost: null };
    const r = simulatePriceChange({ ...input, currentPrice: 18.99, candidatePrice: 21.99 });
    const direct = analyzeMargin({ ...input, sellingPrice: 21.99 });
    expect(r.available).toBe(true);
    if (r.available) expect(r.after.grossMargin).toBe(direct.grossMargin);
  });
});
