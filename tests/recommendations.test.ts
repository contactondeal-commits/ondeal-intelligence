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

describe("marge — vertical slice 03/09/2026 (coût réel Shopify)", () => {
  it("signale une marge brute faible dès que le coût réel est connu, même sans hypothèses de frais (jamais présentée comme une marge nette)", () => {
    const margin = [analyzeMargin({ productId: "p1", variantId: "v1", title: "Harness", sellingPrice: 100, supplierCost: 90, supplierCostSource: "shopify_unit_cost", shippingCost: null, paymentFeesRate: null, otherFixedCost: null })];
    const recs = generateRecommendations({ stock: [], margin, score: [], reviewsWithoutAny: [], activeWithoutStock: [], dataIssues: [] });
    const rec = recs.find((r) => r.category === "margin");
    expect(rec?.title).toContain("Marge brute faible");
    expect(rec?.reason).toContain("coût réel Shopify");
    expect(rec?.reason).toContain("avant transport et frais");
    expect(rec?.actionType).toBe("update_price");
    expect((rec?.actionPayload as { supplierCostSource?: string }).supplierCostSource).toBe("shopify_unit_cost");
  });

  it("n'émet pas d'opportunité « forte marge » pour un produit qui ne vend pas (bruit sur un catalogue dropshipping)", () => {
    const margin = [analyzeMargin({ productId: "p1", variantId: "v1", title: "Produit A", sellingPrice: 100, supplierCost: 20, supplierCostSource: "shopify_unit_cost", shippingCost: 2, paymentFeesRate: 0.02, otherFixedCost: null })];
    const noSales = analyzeStock({ productId: "p1", variantId: "v1", title: "Produit A", sku: null, storeStock: 500, supplierStock: null, unitsSoldLast30Days: 0, lastSyncedAt: null });
    const recsNoSales = generateRecommendations({ stock: [noSales], margin, score: [], reviewsWithoutAny: [], activeWithoutStock: [], dataIssues: [] });
    expect(recsNoSales.some((r) => r.severity === "OPPORTUNITY" && r.category === "margin")).toBe(false);
    const selling = analyzeStock({ ...noSales, unitsSoldLast30Days: 12 } as Parameters<typeof analyzeStock>[0]);
    const recsSelling = generateRecommendations({ stock: [selling], margin, score: [], reviewsWithoutAny: [], activeWithoutStock: [], dataIssues: [] });
    expect(recsSelling.some((r) => r.severity === "OPPORTUNITY" && r.category === "margin")).toBe(true);
  });
});
