import { describe, it, expect } from "vitest";
import {
  parseWhatChangedWindow,
  minOrdersForTrend,
  aggregateWindow,
  computeTrend,
  marginRateDeltaPts,
  computeScoreTrend,
  type MarginSnapshotRow,
} from "@/lib/intelligence/whatChanged";

// « Qu'est-ce qui a changé » (05/09/2026, lot 6) — verrouille : le choix de
// fenêtre (7/30/90, repli sur 30 si invalide), l'agrégation des
// MarginSnapshot par fenêtre (marge calculée uniquement sur la part à coût
// connu via costCoverage, jamais devinée), le seuil anti-bruit du delta en
// %, et la comparaison de score PRODUIT PAR PRODUIT (jamais deux moyennes
// sur des catalogues différents).

describe("parseWhatChangedWindow", () => {
  it("accepte 7/30/90", () => {
    expect(parseWhatChangedWindow("7")).toBe(7);
    expect(parseWhatChangedWindow("30")).toBe(30);
    expect(parseWhatChangedWindow("90")).toBe(90);
  });
  it("replie sur 30 pour toute valeur invalide ou absente", () => {
    expect(parseWhatChangedWindow(undefined)).toBe(30);
    expect(parseWhatChangedWindow("60")).toBe(30);
    expect(parseWhatChangedWindow("abc")).toBe(30);
  });
});

describe("minOrdersForTrend", () => {
  it("seuil plus bas sur 7 jours que sur 30/90", () => {
    expect(minOrdersForTrend(7)).toBe(3);
    expect(minOrdersForTrend(30)).toBe(10);
    expect(minOrdersForTrend(90)).toBe(10);
  });
});

function row(date: string, revenue: number, margin: number | null, costCoverage: number, orderCount: number, unitsSold: number): MarginSnapshotRow {
  return { date: new Date(date), revenue, margin, costCoverage, orderCount, unitsSold };
}

describe("aggregateWindow", () => {
  it("ne somme que les lignes dans [from, toExclusive)", () => {
    const rows = [row("2026-08-01", 100, 50, 1, 2, 3), row("2026-08-15", 200, 100, 1, 4, 5), row("2026-09-01", 300, 150, 1, 6, 7)];
    const agg = aggregateWindow(rows, new Date("2026-08-01"), new Date("2026-09-01"));
    expect(agg.revenue).toBe(300); // 100 + 200, exclut le 01/09
    expect(agg.orderCount).toBe(6);
    expect(agg.unitsSold).toBe(8);
  });

  it("calcule la marge UNIQUEMENT sur la part à coût connu (costCoverage), jamais sur le CA total", () => {
    const rows = [row("2026-08-01", 1000, 100, 0.5, 5, 10)]; // seuls 50% du CA du jour ont un coût connu
    const agg = aggregateWindow(rows, new Date("2026-08-01"), new Date("2026-08-02"));
    expect(agg.marginKnownRevenue).toBe(500); // 1000 * 0.5
    expect(agg.margin).toBe(100);
    expect(agg.marginRate).toBeCloseTo(0.2); // 100 / 500, jamais 100/1000
  });

  it("margin reste null si aucun jour de la fenêtre n'a de coût connu", () => {
    const rows = [row("2026-08-01", 500, null, 0, 3, 4)];
    const agg = aggregateWindow(rows, new Date("2026-08-01"), new Date("2026-08-02"));
    expect(agg.margin).toBeNull();
    expect(agg.marginRate).toBeNull();
  });
});

describe("computeTrend", () => {
  it("refuse un delta si la période précédente n'a pas assez de commandes (seuil selon la fenêtre)", () => {
    expect(computeTrend(500, 100, 2, 7).label).toBeNull(); // 2 < seuil 7j (3)
    expect(computeTrend(500, 100, 5, 30).label).toBeNull(); // 5 < seuil 30j (10)
  });
  it("calcule un delta correct quand le seuil est atteint", () => {
    const t = computeTrend(150, 100, 12, 30);
    expect(t.deltaPct).toBeCloseTo(50);
    expect(t.label).toBe("+50.0 %");
  });
  it("refuse un delta si la période précédente est à zéro (division par zéro)", () => {
    expect(computeTrend(100, 0, 20, 30).label).toBeNull();
  });
});

describe("marginRateDeltaPts", () => {
  it("null si l'un des deux taux est indisponible", () => {
    expect(marginRateDeltaPts(null, 0.2)).toBeNull();
    expect(marginRateDeltaPts(0.2, null)).toBeNull();
  });
  it("écart en points de pourcentage, arrondi à 0.1 pt", () => {
    expect(marginRateDeltaPts(0.25, 0.2)).toBeCloseTo(5);
    expect(marginRateDeltaPts(0.198, 0.2)).toBeCloseTo(-0.2);
  });
});

describe("computeScoreTrend", () => {
  it("compare produit par produit — un produit absent de l'historique n'est simplement pas compté", () => {
    const current = [
      { productId: "p1", score: 80 },
      { productId: "p2", score: 60 },
      { productId: "p3", score: 40 }, // nouveau produit, aucun historique
    ];
    const historical = [
      { productId: "p1", score: 70 },
      { productId: "p2", score: 50 },
    ];
    const result = computeScoreTrend(current, historical);
    expect(result.coverageCount).toBe(2);
    expect(result.totalCurrentCount).toBe(3);
    expect(result.currentAvg).toBeCloseTo(60); // (80+60+40)/3
    expect(result.previousAvg).toBeCloseTo(60); // (70+50)/2
    expect(result.hasEnoughHistory).toBe(true); // 2/3 >= 0.5
    expect(result.deltaPts).toBe(0);
  });

  it("refuse le delta si la couverture est sous 50 % du catalogue actuel", () => {
    const current = [
      { productId: "p1", score: 80 },
      { productId: "p2", score: 60 },
      { productId: "p3", score: 40 },
      { productId: "p4", score: 20 },
    ];
    const historical = [{ productId: "p1", score: 70 }]; // seulement 1/4
    const result = computeScoreTrend(current, historical);
    expect(result.hasEnoughHistory).toBe(false);
    expect(result.deltaPts).toBeNull();
  });

  it("aucun produit actuel → tout est null, jamais une division par zéro qui plante", () => {
    const result = computeScoreTrend([], []);
    expect(result.currentAvg).toBeNull();
    expect(result.hasEnoughHistory).toBe(false);
    expect(result.deltaPts).toBeNull();
  });
});
