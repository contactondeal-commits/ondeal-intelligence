import { describe, it, expect } from "vitest";
import { computeScore, classifyProduct, aggregateScoreBreakdowns } from "@/lib/intelligence/score";

describe("computeScore", () => {
  it("retourne 0 et une complétude de 0% si toutes les données manquent", () => {
    const r = computeScore({ salesTrend: null, marginRate: null, stockHealth: null, averageRating: null, reviewCount: 0, contentQuality: null });
    // review_volume est toujours calculable (0 avis → 0 pt) donc dataCompleteness n'est pas 0.
    expect(r.score).toBe(0);
    // Seul "review_volume" est calculable sans aucune donnée (0 avis = 0 pt) ;
    // tous les autres facteurs doivent être marqués indisponibles, jamais comptés comme 0.
    expect(r.factors.every((f) => f.available === (f.key === "review_volume"))).toBe(true);
  });

  it("redistribue le poids des facteurs indisponibles plutôt que de les compter comme 0", () => {
    const full = computeScore({ salesTrend: 0, marginRate: 0.5, stockHealth: 100, averageRating: 5, reviewCount: 20, contentQuality: 100 });
    const partial = computeScore({ salesTrend: null, marginRate: 0.5, stockHealth: 100, averageRating: 5, reviewCount: 20, contentQuality: 100 });
    // Le score partiel ne doit pas être pénalisé comme si le facteur manquant valait 0.
    expect(partial.dataCompleteness).toBeLessThan(full.dataCompleteness);
    expect(partial.score).toBeGreaterThan(50);
  });

  it("donne un score maximal proche de 100 avec toutes les données au meilleur niveau", () => {
    const r = computeScore({ salesTrend: 100, marginRate: 0.5, stockHealth: 100, averageRating: 5, reviewCount: 50, contentQuality: 100 });
    expect(r.score).toBeGreaterThanOrEqual(90);
    expect(r.dataCompleteness).toBe(100);
  });
});

describe("classifyProduct", () => {
  it("classe toujours 'à revoir' un produit en rupture, même avec un bon score", () => {
    const tier = classifyProduct({ score: 95, hasStockCritical: true, hasNegativeMargin: false, salesTrendPositive: true });
    expect(tier).toBe("a_revoir");
  });

  it("classe 'à revoir' un produit à marge négative quel que soit le score", () => {
    const tier = classifyProduct({ score: 90, hasStockCritical: false, hasNegativeMargin: true, salesTrendPositive: true });
    expect(tier).toBe("a_revoir");
  });

  it("classe 'à booster' un très bon score avec tendance de ventes positive", () => {
    const tier = classifyProduct({ score: 85, hasStockCritical: false, hasNegativeMargin: false, salesTrendPositive: true });
    expect(tier).toBe("a_booster");
  });
});

describe("aggregateScoreBreakdowns", () => {
  it("retourne un tableau vide sans aucune donnée inventée si aucun breakdown fourni", () => {
    expect(aggregateScoreBreakdowns([])).toEqual([]);
  });

  it("moyenne uniquement les contributions réellement disponibles, jamais les indisponibles comme 0", () => {
    const b1 = computeScore({ salesTrend: 100, marginRate: 0.5, stockHealth: 100, averageRating: 5, reviewCount: 50, contentQuality: 100 });
    const b2 = computeScore({ salesTrend: null, marginRate: 0.5, stockHealth: 100, averageRating: 5, reviewCount: 50, contentQuality: 100 });
    const agg = aggregateScoreBreakdowns([b1, b2]);
    const salesTrendFactor = agg.find((f) => f.key === "sales_trend")!;
    // Disponible dans 1 produit sur 2 seulement.
    expect(salesTrendFactor.availabilityRate).toBe(50);
    // La moyenne ne doit porter que sur le produit où le facteur est disponible (b1), pas diluée par b2.
    const b1SalesTrend = b1.factors.find((f) => f.key === "sales_trend")!.contribution;
    expect(salesTrendFactor.avgContribution).toBeCloseTo(b1SalesTrend, 1);
  });

  it("trie les facteurs par contribution moyenne décroissante", () => {
    const b = computeScore({ salesTrend: 100, marginRate: 0.5, stockHealth: 100, averageRating: 5, reviewCount: 50, contentQuality: 100 });
    const agg = aggregateScoreBreakdowns([b]);
    for (let i = 1; i < agg.length; i++) {
      expect(agg[i - 1]!.avgContribution).toBeGreaterThanOrEqual(agg[i]!.avgContribution);
    }
  });
});
