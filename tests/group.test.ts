import { describe, it, expect } from "vitest";
import { groupRecommendations, countBySeverity, type GroupableRecommendation } from "@/lib/intelligence/group";

function rec(overrides: Partial<GroupableRecommendation>): GroupableRecommendation {
  return {
    id: overrides.id ?? Math.random().toString(36),
    category: "stock",
    severity: "URGENT",
    title: "Rupture de stock",
    reason: "Stock à 0",
    impact: "Ventes perdues",
    confidence: 90,
    actionLabel: null,
    actionType: null,
    product: { id: "p1", title: "Produit A" },
    ...overrides,
  };
}

describe("groupRecommendations", () => {
  it("regroupe plusieurs recommandations du même produit/catégorie en un seul groupe", () => {
    const recs = [
      rec({ id: "r1", title: "Variante S en rupture" }),
      rec({ id: "r2", title: "Variante M en rupture" }),
      rec({ id: "r3", title: "Variante L en rupture" }),
    ];
    const groups = groupRecommendations(recs);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.items).toHaveLength(3);
    expect(groups[0]!.title).toContain("3");
    expect(groups[0]!.product?.id).toBe("p1");
  });

  it("ne perd aucune recommandation — la somme des items égale l'entrée", () => {
    const recs = [
      rec({ id: "r1", product: { id: "p1", title: "Produit A" } }),
      rec({ id: "r2", product: { id: "p2", title: "Produit B" } }),
      rec({ id: "r3", product: null, category: "marketing", severity: "OPPORTUNITY" }),
    ];
    const groups = groupRecommendations(recs);
    const totalItems = groups.reduce((sum, g) => sum + g.items.length, 0);
    expect(totalItems).toBe(recs.length);
  });

  it("garde des groupes séparés pour des produits différents", () => {
    const recs = [
      rec({ id: "r1", product: { id: "p1", title: "Produit A" } }),
      rec({ id: "r2", product: { id: "p2", title: "Produit B" } }),
    ];
    const groups = groupRecommendations(recs);
    expect(groups).toHaveLength(2);
  });

  it("garde des groupes séparés pour des catégories différentes sur le même produit", () => {
    const recs = [
      rec({ id: "r1", category: "stock" }),
      rec({ id: "r2", category: "margin", title: "Marge négative" }),
    ];
    const groups = groupRecommendations(recs);
    expect(groups).toHaveLength(2);
  });

  it("trie par sévérité (URGENT avant OPPORTUNITY avant SUGGESTION)", () => {
    const recs = [
      rec({ id: "r1", severity: "SUGGESTION", category: "reviews", product: { id: "p3", title: "C" } }),
      rec({ id: "r2", severity: "URGENT", category: "stock", product: { id: "p1", title: "A" } }),
      rec({ id: "r3", severity: "OPPORTUNITY", category: "marketing", product: { id: "p2", title: "B" } }),
    ];
    const groups = groupRecommendations(recs);
    expect(groups.map((g) => g.severity)).toEqual(["URGENT", "OPPORTUNITY", "SUGGESTION"]);
  });

  it("un seul item conserve son titre original (pas de pluriel artificiel)", () => {
    const groups = groupRecommendations([rec({ id: "r1", title: "Ajoutez une description produit" })]);
    expect(groups[0]!.title).toBe("Ajoutez une description produit");
  });

  it("l'item représentatif est celui de plus haute confiance", () => {
    const recs = [
      rec({ id: "r1", confidence: 40, title: "Faible confiance" }),
      rec({ id: "r2", confidence: 95, title: "Haute confiance" }),
    ];
    const groups = groupRecommendations(recs);
    expect(groups[0]!.representative.title).toBe("Haute confiance");
    expect(groups[0]!.confidence).toBe(95);
  });

  it("impactScore du groupe = somme des impactScore connus, jamais une moyenne ni un item inconnu compté comme 0€", () => {
    const recs = [
      rec({ id: "r1", impactScore: 100 }),
      rec({ id: "r2", impactScore: 50 }),
      rec({ id: "r3", impactScore: null }),
    ];
    const groups = groupRecommendations(recs);
    expect(groups[0]!.impactScore).toBe(150);
    expect(groups[0]!.impactCoverage).toBeCloseTo(2 / 3, 5);
  });

  it("impactScore du groupe reste null (pas 0) quand aucun item n'a d'impact connu", () => {
    const recs = [rec({ id: "r1", impactScore: null }), rec({ id: "r2", impactScore: undefined })];
    const groups = groupRecommendations(recs);
    expect(groups[0]!.impactScore).toBeNull();
    expect(groups[0]!.impactCoverage).toBe(0);
  });

  it("priorise, à sévérité égale, le groupe à impact € connu le plus élevé — jamais un groupe à impact inconnu devant un impact connu", () => {
    const recs = [
      rec({ id: "r1", product: { id: "p1", title: "Petit impact" }, impactScore: 10 }),
      rec({ id: "r2", product: { id: "p2", title: "Impact inconnu" }, impactScore: null }),
      rec({ id: "r3", product: { id: "p3", title: "Gros impact" }, impactScore: 500 }),
    ];
    const groups = groupRecommendations(recs);
    expect(groups.map((g) => g.product?.title)).toEqual(["Gros impact", "Petit impact", "Impact inconnu"]);
  });
});

describe("countBySeverity", () => {
  it("compte correctement chaque sévérité sans double comptage", () => {
    const recs = [
      { severity: "URGENT" as const },
      { severity: "URGENT" as const },
      { severity: "OPPORTUNITY" as const },
      { severity: "SUGGESTION" as const },
    ];
    const counts = countBySeverity(recs);
    expect(counts).toEqual({ urgent: 2, opportunity: 1, suggestion: 1, total: 4 });
  });

  it("retourne des zéros sur une liste vide", () => {
    expect(countBySeverity([])).toEqual({ urgent: 0, opportunity: 0, suggestion: 0, total: 0 });
  });
});
