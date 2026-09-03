import { describe, it, expect } from "vitest";
import { analyzeStock, summarizeStock, STOCK_THRESHOLDS } from "@/lib/intelligence/stock";

describe("analyzeStock", () => {
  it("détecte une rupture quand le stock boutique est à 0", () => {
    const r = analyzeStock({
      productId: "p1", variantId: "v1", title: "Produit A", sku: "SKU-A",
      storeStock: 0, supplierStock: null, unitsSoldLast30Days: 10, lastSyncedAt: null,
    });
    expect(r.status).toBe("rupture");
  });

  it("détecte une incohérence fournisseur (stock boutique 0, fournisseur > 0)", () => {
    const r = analyzeStock({
      productId: "p1", variantId: "v1", title: "Produit A", sku: null,
      storeStock: 0, supplierStock: 50, unitsSoldLast30Days: null, lastSyncedAt: null,
    });
    expect(r.supplierMismatch).toBe(true);
  });

  it("calcule les jours de stock = stock / vitesse de vente", () => {
    const r = analyzeStock({
      productId: "p1", variantId: "v1", title: "Produit A", sku: null,
      storeStock: 30, supplierStock: null, unitsSoldLast30Days: 30, lastSyncedAt: null, // 1/jour
    });
    expect(r.dailyVelocity).toBe(1);
    expect(r.daysOfStock).toBe(30);
    expect(r.status).toBe("stock_normal");
  });

  it("classe en rupture imminente sous le seuil configuré", () => {
    const r = analyzeStock({
      productId: "p1", variantId: "v1", title: "Produit A", sku: null,
      storeStock: 5, supplierStock: null, unitsSoldLast30Days: 30, lastSyncedAt: null, // 1/jour → 5 jours
    });
    expect(r.daysOfStock).toBe(5);
    expect(r.daysOfStock).toBeLessThanOrEqual(STOCK_THRESHOLDS.ruptureImminenteJours);
    expect(r.status).toBe("rupture_imminente");
  });

  it("classe en surstock au-delà du seuil", () => {
    const r = analyzeStock({
      productId: "p1", variantId: "v1", title: "Produit A", sku: null,
      storeStock: 300, supplierStock: null, unitsSoldLast30Days: 30, lastSyncedAt: null, // 1/jour → 300 jours
    });
    expect(r.status).toBe("surstock");
  });

  it("ne devine jamais un statut si le stock est inconnu", () => {
    const r = analyzeStock({
      productId: "p1", variantId: "v1", title: "Produit A", sku: null,
      storeStock: null, supplierStock: null, unitsSoldLast30Days: 10, lastSyncedAt: null,
    });
    expect(r.status).toBe("inconnu");
    expect(r.daysOfStock).toBeNull();
  });

  it("reste 'inconnu' si le stock est connu mais pas la vitesse de vente (jamais une invention)", () => {
    const r = analyzeStock({
      productId: "p1", variantId: "v1", title: "Produit A", sku: null,
      storeStock: 20, supplierStock: null, unitsSoldLast30Days: null, lastSyncedAt: null,
    });
    expect(r.status).toBe("inconnu");
    expect(r.daysOfStock).toBeNull();
  });

  it("détecte le stock dormant (stock présent, aucune vente récente)", () => {
    const r = analyzeStock({
      productId: "p1", variantId: "v1", title: "Produit A", sku: null,
      storeStock: 40, supplierStock: null, unitsSoldLast30Days: 0, lastSyncedAt: null,
    });
    expect(r.status).toBe("stock_dormant");
    expect(r.daysOfStock).toBeNull();
  });
});

describe("summarizeStock", () => {
  it("agrège correctement les compteurs par statut", () => {
    const analyses = [
      analyzeStock({ productId: "1", variantId: "1", title: "A", sku: null, storeStock: 0, supplierStock: null, unitsSoldLast30Days: null, lastSyncedAt: null }),
      analyzeStock({ productId: "2", variantId: "2", title: "B", sku: null, storeStock: 100, supplierStock: null, unitsSoldLast30Days: 1, lastSyncedAt: null }),
    ];
    const summary = summarizeStock(analyses);
    expect(summary.total).toBe(2);
    expect(summary.rupture).toBe(1);
  });
});
