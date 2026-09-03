import { describe, it, expect } from "vitest";
import { analyzeReviews } from "@/lib/intelligence/reviews";

describe("analyzeReviews", () => {
  it("retourne une note moyenne null si aucun avis (jamais 0)", () => {
    const r = analyzeReviews({ storeId: "s1", reviews: [], totalProductCount: 5 });
    expect(r.averageRating).toBeNull();
    expect(r.productsWithoutReviews).toBe(5);
  });

  it("calcule correctement la note moyenne et les compteurs positif/négatif", () => {
    const r = analyzeReviews({
      storeId: "s1",
      totalProductCount: 1,
      reviews: [
        { productId: "p1", rating: 5, title: "Top", body: "Livraison rapide et qualité au rendez-vous.", publishedAt: new Date() },
        { productId: "p1", rating: 1, title: "Déçu", body: "Qualité décevante.", publishedAt: new Date() },
      ],
    });
    expect(r.averageRating).toBe(3);
    expect(r.positiveCount).toBe(1);
    expect(r.negativeCount).toBe(1);
  });

  it("détecte les thèmes uniquement à partir de mots-clés réellement présents", () => {
    const r = analyzeReviews({
      storeId: "s1",
      totalProductCount: 1,
      reviews: [{ productId: "p1", rating: 5, title: null, body: "La livraison était rapide, emballage soigné.", publishedAt: new Date() }],
    });
    const themeNames = r.themes.map((t) => t.theme);
    expect(themeNames).toContain("livraison");
    expect(themeNames).toContain("emballage");
    expect(themeNames).not.toContain("sav");
  });
});
