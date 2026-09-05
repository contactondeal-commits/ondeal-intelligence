import { describe, it, expect } from "vitest";
import { matchIntent, answerQuestion, type AssistantContext, type PageProductContext } from "@/lib/intelligence/assistant";

const BASE_CTX: AssistantContext = {
  recommendations: [],
  stock: [],
  productsWithoutReviews: [],
  salesTrendAvailable: false,
  storeName: "Boutique test",
  pageProduct: null,
};

function pageProduct(overrides: Partial<PageProductContext> = {}): PageProductContext {
  return {
    id: "prod_1",
    title: "Produit Test",
    score: 72,
    dataCompleteness: 80,
    marginGatedByPlan: false,
    costedVariants: 1,
    totalVariants: 1,
    avgMarginRatePct: 42.5,
    stockTotal: 30,
    salesWindowDays: 30,
    salesUnitsSold: 12,
    salesRevenue: 240,
    salesTrendLabel: "+20 %",
    ...overrides,
  };
}

describe("assistant — priorité de « ce produit »/« cette fiche » sur les intentions génériques", () => {
  it("« quelle est la marge de ce produit ? » matche current_product_summary, jamais margin_bad", () => {
    const intent = matchIntent("Quelle est la marge de ce produit ?");
    expect(intent?.key).toBe("current_product_summary");
  });

  it("« cette fiche a-t-elle une bonne marge ? » matche aussi current_product_summary", () => {
    const intent = matchIntent("Cette fiche a-t-elle une bonne marge ?");
    expect(intent?.key).toBe("current_product_summary");
  });

  it("une question générique sans référence à « ce produit » matche toujours margin_bad", () => {
    const intent = matchIntent("Quels produits ont une mauvaise marge ?");
    expect(intent?.key).toBe("margin_bad");
  });
});

describe("current_product_summary — jamais un fait inventé, un repli honnête si aucun contexte", () => {
  it("répond honnêtement si aucune fiche produit n'est en contexte", async () => {
    const res = await answerQuestion("Que penses-tu de ce produit ?", BASE_CTX);
    expect(res.matchedIntent).toBe("current_product_summary");
    expect(res.answer).toMatch(/pas actuellement sur une fiche produit/i);
    expect(res.answer).not.toMatch(/\d/); // aucun chiffre inventé en l'absence de contexte
  });

  it("résume le produit en contexte avec marge disponible et tendance calculable", async () => {
    const ctx: AssistantContext = { ...BASE_CTX, pageProduct: pageProduct() };
    const res = await answerQuestion("Résume ce produit", ctx);
    expect(res.answer).toContain("Produit Test");
    expect(res.answer).toContain("72/100");
    expect(res.answer).toContain("42.5 % (1/1 variante(s)");
    expect(res.answer).toContain("Stock total : 30");
    expect(res.answer).toContain("+20 % vs la période précédente");
  });

  it("marge gatée par le plan → jamais un pourcentage affiché, message d'upsell honnête", async () => {
    const ctx: AssistantContext = {
      ...BASE_CTX,
      pageProduct: pageProduct({ marginGatedByPlan: true, avgMarginRatePct: null, costedVariants: 0 }),
    };
    const res = await answerQuestion("Parle-moi de ce produit", ctx);
    expect(res.answer).toContain("Marge : disponible avec le plan Pro et supérieur.");
    expect(res.answer).not.toMatch(/%.*variante/); // pas de taux affiché malgré le gating
  });

  it("aucune variante costée (plan éligible) → message honnête, jamais 0 % inventé", async () => {
    const ctx: AssistantContext = {
      ...BASE_CTX,
      pageProduct: pageProduct({ avgMarginRatePct: null, costedVariants: 0, totalVariants: 2 }),
    };
    const res = await answerQuestion("Info sur ce produit", ctx);
    expect(res.answer).toContain("non calculable — aucune des 2 variante(s)");
  });

  it("historique de ventes insuffisant → jamais un delta inventé", async () => {
    const ctx: AssistantContext = { ...BASE_CTX, pageProduct: pageProduct({ salesTrendLabel: null }) };
    const res = await answerQuestion("Comment se vend ce produit ?", ctx);
    expect(res.answer).toContain("historique insuffisant sur la période précédente");
    expect(res.answer).not.toMatch(/vs la période précédente/);
  });
});
