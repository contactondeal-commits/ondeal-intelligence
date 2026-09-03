import { describe, it, expect } from "vitest";
import { analyzeMargin, summarizeMargin } from "@/lib/intelligence/margin";

describe("analyzeMargin", () => {
  it("calcule la marge quand toutes les hypothèses sont présentes", () => {
    const r = analyzeMargin({
      productId: "p1", variantId: "v1", title: "Produit A",
      sellingPrice: 50, supplierCost: 20, shippingCost: 5, paymentFeesRate: 0.03, otherFixedCost: null,
    });
    expect(r.missingAssumptions).toEqual([]);
    expect(r.paymentFees).toBeCloseTo(1.5);
    expect(r.totalCost).toBeCloseTo(26.5);
    expect(r.margin).toBeCloseTo(23.5);
    expect(r.marginRate).toBeCloseTo(0.47);
  });

  it("ne calcule PAS la marge si une hypothèse manque (jamais supposée à 0)", () => {
    const r = analyzeMargin({
      productId: "p1", variantId: "v1", title: "Produit A",
      sellingPrice: 50, supplierCost: null, shippingCost: 5, paymentFeesRate: 0.03, otherFixedCost: null,
    });
    expect(r.missingAssumptions).toContain("supplierCost");
    expect(r.margin).toBeNull();
    expect(r.marginRate).toBeNull();
  });

  it("détecte une marge négative", () => {
    const r = analyzeMargin({
      productId: "p1", variantId: "v1", title: "Produit A",
      sellingPrice: 10, supplierCost: 12, shippingCost: 2, paymentFeesRate: 0, otherFixedCost: null,
    });
    expect(r.margin).toBeLessThan(0);
  });
});

describe("summarizeMargin", () => {
  it("ignore les produits sans marge calculable dans les agrégats", () => {
    const analyses = [
      analyzeMargin({ productId: "1", variantId: "1", title: "A", sellingPrice: 50, supplierCost: 10, shippingCost: 2, paymentFeesRate: 0.03, otherFixedCost: null }),
      analyzeMargin({ productId: "2", variantId: "2", title: "B", sellingPrice: null, supplierCost: null, shippingCost: null, paymentFeesRate: null, otherFixedCost: null }),
    ];
    const summary = summarizeMargin(analyses);
    expect(summary.total).toBe(2);
    expect(summary.withData).toBe(1);
  });
});
