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

describe("rupture de stock — impact € estimé et bruit sur les produits inactifs (04/09/2026)", () => {
  it("reste URGENT quand la vélocité est inconnue (pas d'historique de ventes) — jamais assimilée à un vrai zéro", () => {
    const stock = [analyzeStock({ productId: "p1", variantId: "v1", title: "Produit A", sku: null, storeStock: 0, supplierStock: null, unitsSoldLast30Days: null, lastSyncedAt: null })];
    const recs = generateRecommendations({ stock, margin: [], score: [], reviewsWithoutAny: [], activeWithoutStock: [], dataIssues: [] });
    const rec = recs.find((r) => r.category === "stock");
    expect(rec?.severity).toBe("URGENT");
    expect(rec?.impactScore ?? null).toBeNull();
  });

  it("rétrograde en SUGGESTION une rupture confirmée sans aucune vente sur 30 jours (vélocité réellement à 0)", () => {
    const stock = [analyzeStock({ productId: "p1", variantId: "v1", title: "Produit A", sku: null, storeStock: 0, supplierStock: null, unitsSoldLast30Days: 0, lastSyncedAt: null })];
    const recs = generateRecommendations({ stock, margin: [], score: [], reviewsWithoutAny: [], activeWithoutStock: [], dataIssues: [] });
    const rec = recs.find((r) => r.category === "stock");
    expect(rec?.severity).toBe("SUGGESTION");
    expect(rec?.title).toContain("inactif");
  });

  it("calcule un impact € = vélocité × prix × 7 pour une rupture active dont le prix est connu", () => {
    const stock = [analyzeStock({ productId: "p1", variantId: "v1", title: "Produit A", sku: null, storeStock: 0, supplierStock: null, unitsSoldLast30Days: 30, lastSyncedAt: null })]; // 1 unité/jour
    const margin = [analyzeMargin({ productId: "p1", variantId: "v1", title: "Produit A", sellingPrice: 25, supplierCost: 10, shippingCost: null, paymentFeesRate: null, otherFixedCost: null })];
    const recs = generateRecommendations({ stock, margin, score: [], reviewsWithoutAny: [], activeWithoutStock: [], dataIssues: [] });
    const rec = recs.find((r) => r.category === "stock");
    expect(rec?.severity).toBe("URGENT");
    expect(rec?.impactScore).toBeCloseTo(1 * 25 * 7, 5);
  });

  it("laisse l'impact € à null (jamais 0) quand le prix de vente n'est pas connu", () => {
    const stock = [analyzeStock({ productId: "p1", variantId: "v1", title: "Produit A", sku: null, storeStock: 0, supplierStock: null, unitsSoldLast30Days: 30, lastSyncedAt: null })];
    const recs = generateRecommendations({ stock, margin: [], score: [], reviewsWithoutAny: [], activeWithoutStock: [], dataIssues: [] });
    const rec = recs.find((r) => r.category === "stock");
    expect(rec?.impactScore ?? null).toBeNull();
  });

  it("calcule aussi l'impact € pour une rupture imminente", () => {
    const stock = [analyzeStock({ productId: "p1", variantId: "v1", title: "Produit A", sku: null, storeStock: 3, supplierStock: null, unitsSoldLast30Days: 30, lastSyncedAt: null })]; // 1/jour, 3 jours de stock
    const margin = [analyzeMargin({ productId: "p1", variantId: "v1", title: "Produit A", sellingPrice: 40, supplierCost: 10, shippingCost: null, paymentFeesRate: null, otherFixedCost: null })];
    const recs = generateRecommendations({ stock, margin, score: [], reviewsWithoutAny: [], activeWithoutStock: [], dataIssues: [] });
    const rec = recs.find((r) => r.category === "stock");
    expect(rec?.title).toContain("Rupture imminente");
    expect(rec?.impactScore).toBeCloseTo(1 * 40 * 7, 5);
  });
});

describe("rupture de stock — déduplication produit→variantes (04/09/2026)", () => {
  it("garde le format mono-variante (payload variantId singulier) quand un seul variante du produit est en rupture", () => {
    const stock = [analyzeStock({ productId: "p1", variantId: "v1", title: "Produit A", sku: null, storeStock: 0, supplierStock: null, unitsSoldLast30Days: 30, lastSyncedAt: null })];
    const recs = generateRecommendations({ stock, margin: [], score: [], reviewsWithoutAny: [], activeWithoutStock: [], dataIssues: [] });
    const stockRecs = recs.filter((r) => r.category === "stock");
    expect(stockRecs).toHaveLength(1);
    expect(stockRecs[0]!.actionPayload).toMatchObject({ variantId: "v1" });
    expect(stockRecs[0]!.actionPayload).not.toHaveProperty("variantIds");
  });

  it("regroupe en UNE seule recommandation agrégée (payload variantIds pluriel) plusieurs variantes du même produit en rupture, au lieu d'une par variante", () => {
    const stock = [
      analyzeStock({ productId: "p1", variantId: "v1", title: "Produit A — Rouge", sku: null, storeStock: 0, supplierStock: null, unitsSoldLast30Days: 30, lastSyncedAt: null }),
      analyzeStock({ productId: "p1", variantId: "v2", title: "Produit A — Bleu", sku: null, storeStock: 0, supplierStock: null, unitsSoldLast30Days: 30, lastSyncedAt: null }),
      analyzeStock({ productId: "p1", variantId: "v3", title: "Produit A — Vert", sku: null, storeStock: 0, supplierStock: null, unitsSoldLast30Days: 30, lastSyncedAt: null }),
    ];
    const score = [{ productId: "p1", title: "Produit A", score: 50, dataCompleteness: 100 }];
    const recs = generateRecommendations({ stock, margin: [], score, reviewsWithoutAny: [], activeWithoutStock: [], dataIssues: [] });
    const stockRecs = recs.filter((r) => r.category === "stock");
    expect(stockRecs).toHaveLength(1);
    const payload = stockRecs[0]!.actionPayload as { productId: string; variantIds: string[]; variantCount: number; storeStock: number | null; dailyVelocity: number | null };
    expect(payload.variantCount).toBe(3);
    expect(new Set(payload.variantIds)).toEqual(new Set(["v1", "v2", "v3"]));
    expect(stockRecs[0]!.title).toContain("3 variantes");
  });

  it("somme le stock cumulé des variantes du groupe, mais NE SOMME PAS la vélocité (SalesSnapshot est au niveau produit, identique pour chaque variante)", () => {
    // unitsSoldLast30Days identique pour les 2 variantes — reflète le fait
    // que analyzeStock reçoit la MÊME vélocité produit pour chaque variante
    // (voir pipeline.ts) — sommer donnerait 2× la vraie vélocité.
    const stock = [
      analyzeStock({ productId: "p1", variantId: "v1", title: "Produit A — Rouge", sku: null, storeStock: 0, supplierStock: null, unitsSoldLast30Days: 60, lastSyncedAt: null }),
      analyzeStock({ productId: "p1", variantId: "v2", title: "Produit A — Bleu", sku: null, storeStock: 0, supplierStock: null, unitsSoldLast30Days: 60, lastSyncedAt: null }),
    ];
    const score = [{ productId: "p1", title: "Produit A", score: 50, dataCompleteness: 100 }];
    const recs = generateRecommendations({ stock, margin: [], score, reviewsWithoutAny: [], activeWithoutStock: [], dataIssues: [] });
    const payload = recs.find((r) => r.category === "stock")?.actionPayload as { storeStock: number | null; dailyVelocity: number | null };
    expect(payload.storeStock).toBe(0); // 0 + 0
    expect(payload.dailyVelocity).toBeCloseTo(2, 5); // capturée une fois, jamais 4 (2×2)
  });

  it("rétrograde le groupe entier en SUGGESTION quand la vélocité produit est confirmée à 0 (dormant), comme le cas mono-variante", () => {
    const stock = [
      analyzeStock({ productId: "p1", variantId: "v1", title: "Produit A — Rouge", sku: null, storeStock: 0, supplierStock: null, unitsSoldLast30Days: 0, lastSyncedAt: null }),
      analyzeStock({ productId: "p1", variantId: "v2", title: "Produit A — Bleu", sku: null, storeStock: 0, supplierStock: null, unitsSoldLast30Days: 0, lastSyncedAt: null }),
    ];
    const score = [{ productId: "p1", title: "Produit A", score: 50, dataCompleteness: 100 }];
    const recs = generateRecommendations({ stock, margin: [], score, reviewsWithoutAny: [], activeWithoutStock: [], dataIssues: [] });
    const rec = recs.find((r) => r.category === "stock");
    expect(rec?.severity).toBe("SUGGESTION");
    expect(rec?.title).toContain("inactif");
  });

  it("regroupe aussi les ruptures imminentes par produit, en retenant le MINIMUM de jours de stock du groupe (pas une moyenne)", () => {
    const stock = [
      analyzeStock({ productId: "p1", variantId: "v1", title: "Produit A — Rouge", sku: null, storeStock: 1, supplierStock: null, unitsSoldLast30Days: 30, lastSyncedAt: null }), // 1 j de stock
      analyzeStock({ productId: "p1", variantId: "v2", title: "Produit A — Bleu", sku: null, storeStock: 5, supplierStock: null, unitsSoldLast30Days: 30, lastSyncedAt: null }), // 5 j de stock
    ];
    const score = [{ productId: "p1", title: "Produit A", score: 50, dataCompleteness: 100 }];
    const recs = generateRecommendations({ stock, margin: [], score, reviewsWithoutAny: [], activeWithoutStock: [], dataIssues: [] });
    const stockRecs = recs.filter((r) => r.category === "stock");
    expect(stockRecs).toHaveLength(1);
    expect(stockRecs[0]!.title).toContain("Rupture imminente");
    expect(stockRecs[0]!.title).toContain("2 variantes");
    expect(stockRecs[0]!.reason).toContain("1 jour");
  });

  it("les ruptures totales et les ruptures imminentes du même produit restent deux missions distinctes (jamais coalescées)", () => {
    const stock = [
      analyzeStock({ productId: "p1", variantId: "v1", title: "Produit A — Rouge", sku: null, storeStock: 0, supplierStock: null, unitsSoldLast30Days: 30, lastSyncedAt: null }),
      analyzeStock({ productId: "p1", variantId: "v2", title: "Produit A — Bleu", sku: null, storeStock: 1, supplierStock: null, unitsSoldLast30Days: 30, lastSyncedAt: null }),
    ];
    const score = [{ productId: "p1", title: "Produit A", score: 50, dataCompleteness: 100 }];
    const recs = generateRecommendations({ stock, margin: [], score, reviewsWithoutAny: [], activeWithoutStock: [], dataIssues: [] });
    const stockRecs = recs.filter((r) => r.category === "stock");
    expect(stockRecs).toHaveLength(2);
    expect(stockRecs.some((r) => r.title.includes("Rupture de stock"))).toBe(true);
    expect(stockRecs.some((r) => r.title.includes("Rupture imminente"))).toBe(true);
  });
});
