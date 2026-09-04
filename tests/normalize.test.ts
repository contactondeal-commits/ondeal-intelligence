import { describe, it, expect } from "vitest";
import { normalizeVariant, normalizeHandle, detectDuplicateExternalIds } from "@/lib/validation/normalize";

describe("normalizeVariant", () => {
  it("rejette une variante sans identifiant", () => {
    const { variant, issues } = normalizeVariant({ title: "Sans id" });
    expect(variant).toBeNull();
    expect(issues.length).toBe(1);
  });

  it("corrige un prix NaN en null plutôt que de le stocker tel quel", () => {
    const { variant, issues } = normalizeVariant({ id: "gid://shopify/ProductVariant/1", price: "not-a-number" });
    expect(variant?.price).toBeNull();
    expect(issues.some((i) => i.field === "price")).toBe(true);
  });

  it("ramène un stock négatif à 0 et le signale", () => {
    const { variant, issues } = normalizeVariant({ id: "gid://shopify/ProductVariant/1", inventoryQuantity: -5 });
    expect(variant?.inventoryQuantity).toBe(0);
    expect(issues.some((i) => i.field === "inventoryQuantity")).toBe(true);
  });

  it("accepte une variante valide sans anomalie", () => {
    const { variant, issues } = normalizeVariant({ id: "gid://shopify/ProductVariant/1", title: "Default", price: "19.90", inventoryQuantity: 5 });
    expect(variant).not.toBeNull();
    expect(variant?.price).toBe(19.9);
    expect(issues.length).toBe(0);
  });
});

describe("normalizeVariant — coût unitaire réel Shopify (inventoryItem.unitCost)", () => {
  it("conserve le coût unitaire réel et sa devise tels que fournis par Shopify", () => {
    const { variant, issues } = normalizeVariant({
      id: "gid://shopify/ProductVariant/1",
      price: "109.98",
      inventoryItem: { tracked: true, unitCost: { amount: "87.98", currencyCode: "EUR" } },
    });
    expect(variant?.unitCost).toBe(87.98);
    expect(variant?.unitCostCurrency).toBe("EUR");
    expect(issues.length).toBe(0);
  });

  it("laisse le coût à null quand Shopify ne le fournit pas — jamais 0, jamais une hypothèse", () => {
    const { variant } = normalizeVariant({ id: "gid://shopify/ProductVariant/1", price: "28.99", inventoryItem: { tracked: true, unitCost: null } });
    expect(variant?.unitCost).toBeNull();
    expect(variant?.unitCostCurrency).toBeNull();
    const { variant: v2 } = normalizeVariant({ id: "gid://shopify/ProductVariant/2", price: "28.99" });
    expect(v2?.unitCost).toBeNull();
  });

  it("ramène un coût négatif à null et le signale, conserve un coût à 0 en le signalant", () => {
    const neg = normalizeVariant({ id: "gid://shopify/ProductVariant/1", price: "10", inventoryItem: { unitCost: { amount: "-3", currencyCode: "EUR" } } });
    expect(neg.variant?.unitCost).toBeNull();
    expect(neg.issues.some((i) => i.field === "unitCost")).toBe(true);
    const zero = normalizeVariant({ id: "gid://shopify/ProductVariant/2", price: "10", inventoryItem: { unitCost: { amount: "0", currencyCode: "EUR" } } });
    expect(zero.variant?.unitCost).toBe(0);
    expect(zero.issues.some((i) => i.field === "unitCost")).toBe(true);
  });
});

describe("normalizeVariant — qualité de compareAtPrice (signalée, jamais altérée arbitrairement)", () => {
  it("ramène un prix barré à 0 (absence de promotion) à null et le signale", () => {
    const { variant, issues } = normalizeVariant({ id: "gid://shopify/ProductVariant/1", price: "18.99", compareAtPrice: "0.00" });
    expect(variant?.compareAtPrice).toBeNull();
    expect(issues.some((i) => i.field === "compareAtPrice")).toBe(true);
  });

  it("conserve tel quel un prix barré inférieur au prix (pas une promotion) mais le signale — la valeur Shopify n'est pas modifiée", () => {
    const { variant, issues } = normalizeVariant({ id: "gid://shopify/ProductVariant/1", price: "9.99", compareAtPrice: "3.90" });
    expect(variant?.compareAtPrice).toBe(3.9);
    expect(issues.some((i) => i.field === "compareAtPrice" && i.corrected === 3.9)).toBe(true);
  });

  it("ne signale rien pour une vraie promotion (prix barré supérieur au prix)", () => {
    const { variant, issues } = normalizeVariant({ id: "gid://shopify/ProductVariant/1", price: "39.90", compareAtPrice: "59.90" });
    expect(variant?.compareAtPrice).toBe(59.9);
    expect(issues.length).toBe(0);
  });
});

describe("normalizeHandle", () => {
  it("corrige un handle invalide", () => {
    const { handle, issue } = normalizeHandle("Handle Invalide!!", "123");
    expect(handle).toBe("produit-123");
    expect(issue).not.toBeNull();
  });

  it("conserve un handle déjà valide", () => {
    const { handle, issue } = normalizeHandle("mon-produit-valide", "123");
    expect(handle).toBe("mon-produit-valide");
    expect(issue).toBeNull();
  });
});

describe("detectDuplicateExternalIds", () => {
  it("détecte les doublons", () => {
    expect(detectDuplicateExternalIds(["a", "b", "a", "c", "c"])).toEqual(["a", "c"]);
  });
});
