import { describe, it, expect } from "vitest";
import { simulatePriceChange, simulateRestock } from "@/lib/intelligence/simulate";
import { analyzeStock } from "@/lib/intelligence/stock";

describe("simulatePriceChange", () => {
  it("calcule un delta de marge réel entre le prix actuel et un prix candidat", () => {
    const r = simulatePriceChange({
      productId: "p1", variantId: "v1", title: "Produit A",
      currentPrice: 20, supplierCost: 12, shippingCost: 2, paymentFeesRate: 0.03, otherFixedCost: null,
      candidatePrice: 25,
    });
    expect(r.available).toBe(true);
    if (r.available) {
      // avant : 20 - (12 + 2 + 0.6) = 5.4 — après : 25 - (12 + 2 + 0.75) = 10.25
      expect(r.before.margin).toBeCloseTo(5.4);
      expect(r.after.margin).toBeCloseTo(10.25);
      expect(r.deltaMargin).toBeCloseTo(4.85);
      expect(r.deltaMarginRate).not.toBeNull();
    }
  });

  it("refuse un prix candidat invalide sans calculer de faux résultat", () => {
    const r = simulatePriceChange({
      productId: "p1", variantId: "v1", title: "Produit A",
      currentPrice: 20, supplierCost: 12, shippingCost: 2, paymentFeesRate: 0.03, otherFixedCost: null,
      candidatePrice: -5,
    });
    expect(r.available).toBe(false);
  });

  it("indique explicitement l'indisponibilité si une hypothèse de coût manque (jamais 0 par défaut)", () => {
    const r = simulatePriceChange({
      productId: "p1", variantId: "v1", title: "Produit A",
      currentPrice: 20, supplierCost: null, shippingCost: 2, paymentFeesRate: 0.03, otherFixedCost: null,
      candidatePrice: 25,
    });
    expect(r.available).toBe(false);
    if (!r.available) {
      expect(r.reason).toContain("supplierCost");
    }
  });
});

describe("simulateRestock", () => {
  it("projette le stock et les jours de stock à partir de la vélocité réelle", () => {
    const r = simulateRestock({ currentStock: 5, dailyVelocity: 2, candidateAddedUnits: 20 });
    expect(r.available).toBe(true);
    if (r.available) {
      expect(r.projectedStock).toBe(25);
      expect(r.projectedDaysOfStock).toBeCloseTo(12.5);
    }
  });

  it("refuse une quantité invalide", () => {
    const r = simulateRestock({ currentStock: 5, dailyVelocity: 2, candidateAddedUnits: 0 });
    expect(r.available).toBe(false);
  });

  it("indique l'indisponibilité si aucune vélocité de vente n'est connue (pas de division par une donnée absente)", () => {
    const r = simulateRestock({ currentStock: 5, dailyVelocity: null, candidateAddedUnits: 20 });
    expect(r.available).toBe(false);
  });

  it("indique l'indisponibilité si la vélocité est nulle (aucune vente récente)", () => {
    const r = simulateRestock({ currentStock: 5, dailyVelocity: 0, candidateAddedUnits: 20 });
    expect(r.available).toBe(false);
  });

  it("indique l'indisponibilité si le stock boutique actuel est inconnu", () => {
    const r = simulateRestock({ currentStock: null, dailyVelocity: 2, candidateAddedUnits: 20 });
    expect(r.available).toBe(false);
  });

  it("réutilise exactement les seuils d'analyzeStock pour le statut projeté (même vérité métier que le module Stock)", () => {
    // 20 unités / 2 par jour = 10 jours → doit retomber pile sur le seuil
    // "rupture_imminente" (<= 7j) vs "stock_faible" (<= 14j) d'analyzeStock,
    // jamais un seuil réinventé indépendamment ici.
    const r = simulateRestock({ currentStock: 0, dailyVelocity: 2, candidateAddedUnits: 20 });
    expect(r.available).toBe(true);
    if (r.available) {
      expect(r.projectedDaysOfStock).toBeCloseTo(10);
      expect(r.projectedStatus).toBe("stock_faible");
    }
  });

  it("le statut projeté correspond à analyzeStock appelé directement sur le même stock projeté (aucune divergence entre analyse et simulation)", () => {
    const r = simulateRestock({ currentStock: 5, dailyVelocity: 1, candidateAddedUnits: 3 }); // projeté = 8, vélocité 1 → 8 jours de stock
    expect(r.available).toBe(true);
    if (r.available) {
      const direct = analyzeStock({
        productId: "p1",
        variantId: "v1",
        title: "t",
        sku: null,
        storeStock: 8,
        supplierStock: null,
        unitsSoldLast30Days: 30,
        lastSyncedAt: null,
      });
      expect(r.projectedStatus).toBe(direct.status);
      expect(r.projectedDaysOfStock).toBeCloseTo(direct.daysOfStock ?? -1);
    }
  });
});
