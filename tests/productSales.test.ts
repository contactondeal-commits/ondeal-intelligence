import { describe, it, expect } from "vitest";
import {
  aggregateProductSalesWindow,
  minUnitsForProductTrend,
  computeProductSalesTrend,
  type ProductSalesRow,
} from "@/lib/intelligence/productSales";

const rows: ProductSalesRow[] = [
  { date: new Date("2026-08-01T00:00:00Z"), unitsSold: 5, revenue: 100 },
  { date: new Date("2026-08-15T00:00:00Z"), unitsSold: 3, revenue: 60 },
  { date: new Date("2026-08-20T00:00:00Z"), unitsSold: 0, revenue: 0 },
  { date: new Date("2026-09-01T00:00:00Z"), unitsSold: 10, revenue: 250 },
];

describe("aggregateProductSalesWindow — agrégat des ventes RÉELLES d'un seul produit sur une fenêtre", () => {
  it("ne compte que les lignes dans [from, toExclusive)", () => {
    const agg = aggregateProductSalesWindow(rows, new Date("2026-08-01T00:00:00Z"), new Date("2026-09-01T00:00:00Z"));
    expect(agg.unitsSold).toBe(8);
    expect(agg.revenue).toBe(160);
    expect(agg.daysWithSales).toBe(2);
  });

  it("exclut les jours à 0 vente du compte de jours actifs mais pas du total", () => {
    const agg = aggregateProductSalesWindow(rows, new Date("2026-08-01T00:00:00Z"), new Date("2026-08-21T00:00:00Z"));
    expect(agg.unitsSold).toBe(8);
    expect(agg.daysWithSales).toBe(2);
  });

  it("fenêtre vide → agrégat nul, jamais une erreur", () => {
    const agg = aggregateProductSalesWindow(rows, new Date("2020-01-01T00:00:00Z"), new Date("2020-02-01T00:00:00Z"));
    expect(agg).toEqual({ unitsSold: 0, revenue: 0, daysWithSales: 0 });
  });
});

describe("minUnitsForProductTrend — seuil anti-bruit plus bas sur 7j que sur 30/90j", () => {
  it("7 jours : seuil de 3 unités", () => {
    expect(minUnitsForProductTrend(7)).toBe(3);
  });
  it("30 et 90 jours : seuil de 8 unités", () => {
    expect(minUnitsForProductTrend(30)).toBe(8);
    expect(minUnitsForProductTrend(90)).toBe(8);
  });
});

describe("computeProductSalesTrend — jamais un delta calculé sur une fenêtre précédente trop faible", () => {
  it("insuffisant : fenêtre précédente sous le seuil (7j, 2 unités < 3)", () => {
    const r = computeProductSalesTrend({ unitsSold: 10, revenue: 200, daysWithSales: 2 }, { unitsSold: 2, revenue: 40, daysWithSales: 1 }, 7);
    expect(r.deltaUnitsPct).toBeNull();
    expect(r.deltaRevenuePct).toBeNull();
    expect(r.label).toBeNull();
  });

  it("disponible : fenêtre précédente au-dessus du seuil, delta correctement calculé", () => {
    const r = computeProductSalesTrend(
      { unitsSold: 15, revenue: 300, daysWithSales: 3 },
      { unitsSold: 10, revenue: 200, daysWithSales: 2 },
      30,
    );
    expect(r.deltaUnitsPct).toBeCloseTo(50, 5);
    expect(r.deltaRevenuePct).toBeCloseTo(50, 5);
    expect(r.label).toBe("+50 %");
  });

  it("delta unités disponible mais CA précédent nul → deltaRevenuePct reste null (jamais une division par zéro déguisée)", () => {
    const r = computeProductSalesTrend({ unitsSold: 10, revenue: 100, daysWithSales: 1 }, { unitsSold: 10, revenue: 0, daysWithSales: 1 }, 30);
    expect(r.deltaUnitsPct).toBeCloseTo(0, 5);
    expect(r.deltaRevenuePct).toBeNull();
  });

  it("baisse réelle affichée avec le signe correct", () => {
    const r = computeProductSalesTrend({ unitsSold: 5, revenue: 50, daysWithSales: 1 }, { unitsSold: 10, revenue: 100, daysWithSales: 1 }, 30);
    expect(r.deltaUnitsPct).toBeCloseTo(-50, 5);
    expect(r.label).toBe("-50 %");
  });
});
