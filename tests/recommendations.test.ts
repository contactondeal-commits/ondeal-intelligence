import { describe, it, expect } from "vitest";
import { generateRecommendations } from "@/lib/intelligence/recommendations";
import { analyzeStock } from "@/lib/intelligence/stock";
import { analyzeMargin } from "@/lib/intelligence/margin";

describe("generateRecommendations", () => {
  it("génère une recommandation URGENT pour une rupture de stock", () => {
    const stock = [analyzeStock({ productId: "p1", variantId: "v1", title: "Produit A", sku: null, storeStock: 0, supplierStock: null, unitsSoldLast30Days: null, lastSyncedAt: null })];
    const recs = generateRecommendations({ stock, margin: [], score: [], reviewsWithoutAny: [], activeWithoutStock: [], dataIssues: [] });
    expect(recs.some((r) => r.severity === "URGENT" && r.category === "stock")).toBe(true);
  });

  it("génère une recommandation URGENT pour une marge négative", () => {
    const margin = [analyzeMargin({ productId: "p1", variantId: "v1", title: "Produit A", sellingPrice: 10, supplierCost: 15, shippingCost: 2, paymentFeesRate: 0, otherFixedCost: null })];
    const recs = generateRecommendations({ stock: [], margin, score: [], reviewsWithoutAny: [], activeWithoutStock: [], dataIssues: [] });
    expect(recs.some((r) => r.severity === "URGENT" && r.category === "margin")).toBe(true);
  });

  it("génère une OPPORTUNITY pour une forte marge, pas une URGENT", () => {
    const margin = [analyzeMargin({ productId: "p1", variantId: "v1", title: "Produit A", sellingPrice: 100, supplierCost: 20, shippingCost: 2, paymentFeesRate: 0.02, otherFixedCost: null })];
    const recs = generateRecommendations({ stock: [], margin, score: [], reviewsWithoutAny: [], activeWithoutStock: [], dataIssues: [] });
    const marginRecs = recs.filter((r) => r.category === "margin");
    expect(marginRecs.some((r) => r.severity === "OPPORTUNITY")).toBe(true);
  });

  it("ne génère aucune recommandation depuis un contexte totalement vide", () => {
    const recs = generateRecommendations({ stock: [], margin: [], score: [], reviewsWithoutAny: [], activeWithoutStock: [], dataIssues: [] });
    expect(recs).toEqual([]);
  });

  it("signale un produit actif publié sans aucun stock", () => {
    const recs = generateRecommendations({
      stock: [], margin: [], score: [], reviewsWithoutAny: [],
      activeWithoutStock: [{ productId: "p1", title: "Produit A" }],
      dataIssues: [],
    });
    expect(recs.some((r) => r.actionType === "unpublish_product")).toBe(true);
  });
});
