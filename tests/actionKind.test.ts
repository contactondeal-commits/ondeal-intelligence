import { describe, it, expect } from "vitest";
import { actionKindFor, criticalTargetKey } from "@/lib/intelligence/actionKind";

describe("actionKindFor — AUTOMATED ACTION vs MANUAL MISSION", () => {
  it("classe update_price, unpublish_product et update_stock comme automated_mutation (mutation Shopify réelle disponible)", () => {
    expect(actionKindFor("update_price")).toBe("automated_mutation");
    expect(actionKindFor("unpublish_product")).toBe("automated_mutation");
    // update_stock : correctif 05/09/2026 — le type était déjà prévu dans le
    // schéma/SENSITIVE_ACTION_TYPES mais aucune mutation n'existait encore.
    expect(actionKindFor("update_stock")).toBe("automated_mutation");
  });

  it("classe les types sans mutation réelle comme manual_mission (jamais présenté comme une vraie exécution)", () => {
    expect(actionKindFor("review_supplier")).toBe("manual_mission");
    expect(actionKindFor("request_reviews")).toBe("manual_mission");
    expect(actionKindFor("promote_product")).toBe("manual_mission");
    expect(actionKindFor("edit_product_data")).toBe("manual_mission");
  });

  it("traite un type inconnu ou absent comme manual_mission par défaut (jamais une fausse exécution automatique)", () => {
    expect(actionKindFor(null)).toBe("manual_mission");
    expect(actionKindFor(undefined)).toBe("manual_mission");
    expect(actionKindFor("some_future_type")).toBe("manual_mission");
  });
});

describe("criticalTargetKey — conflit entre deux ActionItems ciblant la même donnée critique", () => {
  it("deux recommandations DIFFÉRENTES ciblant la MÊME variante avec update_price produisent la MÊME clé (conflit détecté, comportement déterministe — cas 4)", () => {
    const keyA = criticalTargetKey("update_price", { variantId: "v1" }, null);
    const keyB = criticalTargetKey("update_price", { variantId: "v1" }, null);
    expect(keyA).not.toBeNull();
    expect(keyA).toBe(keyB);
  });

  it("deux recommandations sur DEUX variantes DIFFÉRENTES du même produit ne conflictent jamais (cas 5 — pas de blocage inutile)", () => {
    const keyA = criticalTargetKey("update_price", { variantId: "v1", productId: "p1" }, "p1");
    const keyB = criticalTargetKey("update_price", { variantId: "v2", productId: "p1" }, "p1");
    expect(keyA).not.toBe(keyB);
  });

  it("deux recommandations de catégories différentes (stock vs data_quality) mais même variante en review_supplier conflictent (cas réel du moteur de recommandations)", () => {
    // recommendations.ts : supplierMismatch génère à la fois une reco "stock"
    // (rupture) et une reco "data_quality" (incohérence fournisseur), toutes
    // deux actionType=review_supplier, sur la même variante.
    const keyStock = criticalTargetKey("review_supplier", { variantId: "v1", storeStock: 0, dailyVelocity: 1.2 }, null);
    const keyDataQuality = criticalTargetKey("review_supplier", { variantId: "v1" }, null);
    expect(keyStock).toBe(keyDataQuality);
  });

  it("unpublish_product conflicte au niveau du produit (le statut vit sur le produit, pas la variante)", () => {
    const keyA = criticalTargetKey("unpublish_product", { productId: "p1" }, null);
    const keyB = criticalTargetKey("unpublish_product", {}, "p1"); // productId via le fallback (Recommendation.productId)
    expect(keyA).toBe(keyB);
  });

  it("update_stock conflicte au niveau de la variante, comme update_price (le stock vit sur la variante)", () => {
    const keyA = criticalTargetKey("update_stock", { variantId: "v1" }, null);
    const keyB = criticalTargetKey("update_stock", { variantId: "v1" }, null);
    expect(keyA).not.toBeNull();
    expect(keyA).toBe(keyB);
    const keyOtherVariant = criticalTargetKey("update_stock", { variantId: "v2" }, null);
    expect(keyA).not.toBe(keyOtherVariant);
    // Ne doit jamais se confondre avec update_price sur la même variante —
    // deux données mutables distinctes (stock vs prix), jamais un conflit.
    const priceKey = criticalTargetKey("update_price", { variantId: "v1" }, null);
    expect(keyA).not.toBe(priceKey);
  });

  it("les types sans donnée mutable partagée (promote_product, request_reviews, edit_product_data) ne produisent jamais de clé — jamais de faux conflit", () => {
    expect(criticalTargetKey("promote_product", { productId: "p1" }, "p1")).toBeNull();
    expect(criticalTargetKey("request_reviews", { productId: "p1" }, "p1")).toBeNull();
    expect(criticalTargetKey("edit_product_data", { productId: "p1" }, "p1")).toBeNull();
  });

  it("retourne null si la donnée nécessaire est absente (rien à comparer, pas de faux conflit)", () => {
    expect(criticalTargetKey("update_price", {}, null)).toBeNull();
    expect(criticalTargetKey("unpublish_product", {}, null)).toBeNull();
  });

  it("review_supplier agrégé (payload variantIds pluriel, 04/09/2026) — même ensemble de variantes produit la même clé, indépendamment de l'ordre", () => {
    const keyA = criticalTargetKey("review_supplier", { productId: "p1", variantIds: ["v1", "v2", "v3"] }, null);
    const keyB = criticalTargetKey("review_supplier", { productId: "p1", variantIds: ["v3", "v1", "v2"] }, null);
    expect(keyA).not.toBeNull();
    expect(keyA).toBe(keyB);
  });

  it("review_supplier agrégé — deux ensembles de variantes disjoints du MÊME produit (ex. rupture totale vs rupture imminente) ne conflictent jamais", () => {
    const keyRupture = criticalTargetKey("review_supplier", { productId: "p1", variantIds: ["v1", "v2"] }, null);
    const keyImminente = criticalTargetKey("review_supplier", { productId: "p1", variantIds: ["v3", "v4"] }, null);
    expect(keyRupture).not.toBe(keyImminente);
  });

  it("review_supplier agrégé — le fallback productId (Recommendation.productId) est utilisé quand le payload ne le porte pas directement", () => {
    const keyA = criticalTargetKey("review_supplier", { variantIds: ["v1", "v2"] }, "p1");
    const keyB = criticalTargetKey("review_supplier", { productId: "p1", variantIds: ["v1", "v2"] }, null);
    expect(keyA).toBe(keyB);
  });
});
