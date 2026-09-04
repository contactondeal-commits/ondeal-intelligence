import { describe, it, expect } from "vitest";
import { computeBulkPrice } from "@/lib/intelligence/bulkPricing";

describe("computeBulkPrice — factor", () => {
  it("applique le facteur au prix actuel", () => {
    const r = computeBulkPrice({ kind: "factor", factor: 2.5 }, 20, { supplierCost: null, shippingCost: null, paymentFeesRate: null, otherFixedCost: null });
    expect(r).toEqual({ ok: true, newPrice: 50 });
  });

  it("refuse sans prix actuel connu", () => {
    const r = computeBulkPrice({ kind: "factor", factor: 2.5 }, null, { supplierCost: null, shippingCost: null, paymentFeesRate: null, otherFixedCost: null });
    expect(r.ok).toBe(false);
  });

  it("refuse un facteur invalide", () => {
    const r = computeBulkPrice({ kind: "factor", factor: 0 }, 20, { supplierCost: null, shippingCost: null, paymentFeesRate: null, otherFixedCost: null });
    expect(r.ok).toBe(false);
  });
});

describe("computeBulkPrice — target_margin", () => {
  it("résout le prix atteignant le taux de marge complet visé", () => {
    // fixedCost = 12 + 2 = 14, feesRate = 0.03, target = 0.20
    // price = 14 / (1 - 0.03 - 0.20) = 14 / 0.77 = 18.1818...
    const r = computeBulkPrice(
      { kind: "target_margin", targetRate: 0.2 },
      20,
      { supplierCost: 12, shippingCost: 2, paymentFeesRate: 0.03, otherFixedCost: null },
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.newPrice).toBeCloseTo(18.18, 1);
  });

  it("le prix résolu reproduit bien le taux de marge visé une fois réinjecté", () => {
    const supplierCost = 12, shippingCost = 2, paymentFeesRate = 0.03, target = 0.2;
    const r = computeBulkPrice({ kind: "target_margin", targetRate: target }, 20, { supplierCost, shippingCost, paymentFeesRate, otherFixedCost: null });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const margin = r.newPrice - (supplierCost + shippingCost + r.newPrice * paymentFeesRate);
      expect(margin / r.newPrice).toBeCloseTo(target, 2);
    }
  });

  it("refuse sans coût fournisseur connu", () => {
    const r = computeBulkPrice({ kind: "target_margin", targetRate: 0.2 }, 20, { supplierCost: null, shippingCost: 2, paymentFeesRate: 0.03, otherFixedCost: null });
    expect(r.ok).toBe(false);
  });

  it("refuse une cible incompatible avec les frais de paiement (dénominateur <= 0)", () => {
    const r = computeBulkPrice({ kind: "target_margin", targetRate: 0.9 }, 20, { supplierCost: 12, shippingCost: 2, paymentFeesRate: 0.15, otherFixedCost: null });
    expect(r.ok).toBe(false);
  });
});
