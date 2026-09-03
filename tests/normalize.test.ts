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
