import { describe, it, expect } from "vitest";
import {
  buildPriceSnapshot,
  comparePriceSnapshot,
  describeSnapshotChange,
  isPriceSnapshot,
  buildStockSnapshot,
  compareStockSnapshot,
  describeStockSnapshotChange,
  isStockSnapshot,
  buildMultiStockSnapshot,
  compareMultiStockSnapshot,
  describeMultiStockSnapshotChange,
  isMultiStockSnapshot,
} from "@/lib/intelligence/snapshot";

const BASE_FIELDS = {
  currentPrice: 19.9,
  supplierCost: 8,
  shippingCost: 2,
  paymentFeesRate: 0.029,
  otherFixedCost: null,
};

describe("buildPriceSnapshot / isPriceSnapshot", () => {
  it("construit un snapshot exploitable reconnu par le type guard", () => {
    const snap = buildPriceSnapshot({
      productId: "p1",
      variantId: "v1",
      candidateValue: 24.9,
      fields: BASE_FIELDS,
      observedAt: new Date("2026-09-03T21:00:00Z"),
    });
    expect(isPriceSnapshot(snap)).toBe(true);
    expect(snap.observedAt).toBe("2026-09-03T21:00:00.000Z");
    expect(snap.candidateValue).toBe(24.9);
  });

  it("rejette une valeur qui ne ressemble pas à un snapshot (repli sur l'ancien comportement)", () => {
    expect(isPriceSnapshot(null)).toBe(false);
    expect(isPriceSnapshot(undefined)).toBe(false);
    expect(isPriceSnapshot({ currentPrice: 20 })).toBe(false);
    expect(isPriceSnapshot("not an object")).toBe(false);
  });
});

describe("comparePriceSnapshot — scénario 21:00 simulation / 21:05 changement Shopify / 21:07 exécution", () => {
  it("ne détecte aucun écart quand rien n'a changé (exécution autorisée)", () => {
    const snap = buildPriceSnapshot({ productId: "p1", variantId: "v1", candidateValue: 24.9, fields: BASE_FIELDS });
    const cmp = comparePriceSnapshot(snap, BASE_FIELDS);
    expect(cmp.stale).toBe(false);
    expect(cmp.changedFields).toHaveLength(0);
  });

  it("détecte un prix modifié entre la simulation et l'exécution (exécution refusée)", () => {
    const snap = buildPriceSnapshot({ productId: "p1", variantId: "v1", candidateValue: 24.9, fields: BASE_FIELDS });
    const current = { ...BASE_FIELDS, currentPrice: 24.5 }; // synchro Shopify entre-temps
    const cmp = comparePriceSnapshot(snap, current);
    expect(cmp.stale).toBe(true);
    expect(cmp.changedFields).toHaveLength(1);
    expect(cmp.changedFields[0]!.field).toBe("currentPrice");
  });

  it("détecte un coût fournisseur modifié même si le prix n'a pas bougé", () => {
    const snap = buildPriceSnapshot({ productId: "p1", variantId: "v1", candidateValue: 24.9, fields: BASE_FIELDS });
    const current = { ...BASE_FIELDS, supplierCost: 11 };
    const cmp = comparePriceSnapshot(snap, current);
    expect(cmp.stale).toBe(true);
    expect(cmp.changedFields.map((c) => c.field)).toContain("supplierCost");
  });

  it("tolère les imprécisions flottantes (pas un vrai écart)", () => {
    const snap = buildPriceSnapshot({ productId: "p1", variantId: "v1", candidateValue: 24.9, fields: BASE_FIELDS });
    const current = { ...BASE_FIELDS, currentPrice: 19.9 + 1e-9 };
    const cmp = comparePriceSnapshot(snap, current);
    expect(cmp.stale).toBe(false);
  });

  it("traite l'apparition/disparition d'une donnée comme un changement réel, jamais ignoré", () => {
    const snap = buildPriceSnapshot({ productId: "p1", variantId: "v1", candidateValue: 24.9, fields: BASE_FIELDS });
    const current = { ...BASE_FIELDS, otherFixedCost: 1.5 }; // était null, maintenant connu
    const cmp = comparePriceSnapshot(snap, current);
    expect(cmp.stale).toBe(true);
    expect(cmp.changedFields.map((c) => c.field)).toContain("otherFixedCost");
  });

  it("produit un message explicite listant exactement ce qui a changé (jamais un simple 'obsolète')", () => {
    const snap = buildPriceSnapshot({ productId: "p1", variantId: "v1", candidateValue: 24.9, fields: BASE_FIELDS });
    const current = { ...BASE_FIELDS, currentPrice: 24.5 };
    const cmp = comparePriceSnapshot(snap, current);
    const message = describeSnapshotChange(cmp);
    expect(message).toContain("Prix actuel");
    expect(message).toContain("19.90 €");
    expect(message).toContain("24.50 €");
    expect(message).toContain("nouvelle simulation est nécessaire");
  });

  it("describeSnapshotChange retourne une chaîne vide quand rien n'est obsolète", () => {
    expect(describeSnapshotChange({ stale: false, changedFields: [] })).toBe("");
  });
});

const STOCK_FIELDS = { currentStock: 0, dailyVelocity: 1.4 };

describe("buildStockSnapshot / isStockSnapshot", () => {
  it("construit un snapshot stock exploitable reconnu par le type guard", () => {
    const snap = buildStockSnapshot({ productId: "p1", variantId: "v1", candidateAddedUnits: 20, fields: STOCK_FIELDS });
    expect(isStockSnapshot(snap)).toBe(true);
    expect(snap.kind).toBe("stock");
  });

  it("rejette un snapshot prix comme snapshot stock (kind différent) et réciproquement", () => {
    const priceSnap = buildPriceSnapshot({ productId: "p1", variantId: "v1", candidateValue: 24.9, fields: BASE_FIELDS });
    expect(isStockSnapshot(priceSnap)).toBe(false);
    const stockSnap = buildStockSnapshot({ productId: "p1", variantId: "v1", candidateAddedUnits: null, fields: STOCK_FIELDS });
    expect(isPriceSnapshot(stockSnap)).toBe(false);
  });
});

describe("compareStockSnapshot — même protection que le prix, appliquée à la preuve stock", () => {
  it("stock identique → aucun écart, exécution/mission autorisée (cas 1)", () => {
    const snap = buildStockSnapshot({ productId: "p1", variantId: "v1", candidateAddedUnits: null, fields: STOCK_FIELDS });
    const cmp = compareStockSnapshot(snap, STOCK_FIELDS);
    expect(cmp.stale).toBe(false);
    expect(cmp.changedFields).toHaveLength(0);
  });

  it("stock modifié après la préparation de la mission → bloqué (cas 2)", () => {
    const snap = buildStockSnapshot({ productId: "p1", variantId: "v1", candidateAddedUnits: null, fields: STOCK_FIELDS });
    const current = { ...STOCK_FIELDS, currentStock: 5 }; // réapprovisionné entre-temps par une autre voie
    const cmp = compareStockSnapshot(snap, current);
    expect(cmp.stale).toBe(true);
    expect(cmp.changedFields.map((c) => c.field)).toContain("currentStock");
  });

  it("le moindre écart de stock (compte entier) est détecté — aucune tolérance implicite", () => {
    const snap = buildStockSnapshot({ productId: "p1", variantId: "v1", candidateAddedUnits: null, fields: STOCK_FIELDS });
    const cmp = compareStockSnapshot(snap, { ...STOCK_FIELDS, currentStock: 1 });
    expect(cmp.stale).toBe(true);
  });

  it("détecte une vélocité de vente réellement changée, tolère l'imprécision flottante", () => {
    const snap = buildStockSnapshot({ productId: "p1", variantId: "v1", candidateAddedUnits: null, fields: STOCK_FIELDS });
    expect(compareStockSnapshot(snap, { ...STOCK_FIELDS, dailyVelocity: 1.4 + 1e-9 }).stale).toBe(false);
    expect(compareStockSnapshot(snap, { ...STOCK_FIELDS, dailyVelocity: 2.1 }).stale).toBe(true);
  });

  it("produit un message explicite listant exactement ce qui a changé, distinct du message prix", () => {
    const snap = buildStockSnapshot({ productId: "p1", variantId: "v1", candidateAddedUnits: null, fields: STOCK_FIELDS });
    const cmp = compareStockSnapshot(snap, { ...STOCK_FIELDS, currentStock: 5 });
    const message = describeStockSnapshotChange(cmp);
    expect(message).toContain("Stock actuel");
    expect(message).toContain("0 unité");
    expect(message).toContain("5 unité");
    expect(message).toContain("mission");
  });
});

describe("buildMultiStockSnapshot / isMultiStockSnapshot — mission agrégée par produit (04/09/2026)", () => {
  it("construit un snapshot multi-variante exploitable reconnu par le type guard", () => {
    const snap = buildMultiStockSnapshot({
      productId: "p1",
      variantIds: ["v1", "v2"],
      variants: [
        { variantId: "v1", currentStock: 0, dailyVelocity: 1.2 },
        { variantId: "v2", currentStock: 0, dailyVelocity: 1.2 },
      ],
    });
    expect(isMultiStockSnapshot(snap)).toBe(true);
    expect(snap.variantIds).toEqual(["v1", "v2"]);
  });

  it("rejette un snapshot stock mono-variante (kind différent) comme snapshot multi-variante, et réciproquement", () => {
    const single = buildStockSnapshot({ productId: "p1", variantId: "v1", candidateAddedUnits: null, fields: { currentStock: 0, dailyVelocity: 1.2 } });
    const multi = buildMultiStockSnapshot({ productId: "p1", variantIds: ["v1"], variants: [{ variantId: "v1", currentStock: 0, dailyVelocity: 1.2 }] });
    expect(isMultiStockSnapshot(single)).toBe(false);
    expect(isStockSnapshot(multi)).toBe(false);
  });

  it("aucun écart quand toutes les variantes du groupe sont inchangées (mission autorisée)", () => {
    const snap = buildMultiStockSnapshot({
      productId: "p1",
      variantIds: ["v1", "v2"],
      variants: [
        { variantId: "v1", currentStock: 0, dailyVelocity: 1.2 },
        { variantId: "v2", currentStock: 0, dailyVelocity: 1.2 },
      ],
    });
    const current = new Map([
      ["v1", { currentStock: 0, dailyVelocity: 1.2 }],
      ["v2", { currentStock: 0, dailyVelocity: 1.2 }],
    ]);
    expect(compareMultiStockSnapshot(snap, current).stale).toBe(false);
  });

  it("détecte qu'UNE SEULE variante du groupe a changé (ex. réapprovisionnée entre-temps) — la mission entière est marquée obsolète, jamais moyennée", () => {
    const snap = buildMultiStockSnapshot({
      productId: "p1",
      variantIds: ["v1", "v2"],
      variants: [
        { variantId: "v1", currentStock: 0, dailyVelocity: 1.2 },
        { variantId: "v2", currentStock: 0, dailyVelocity: 1.2 },
      ],
    });
    const current = new Map([
      ["v1", { currentStock: 0, dailyVelocity: 1.2 }],
      ["v2", { currentStock: 5, dailyVelocity: 1.2 }], // v2 réapprovisionnée
    ]);
    const cmp = compareMultiStockSnapshot(snap, current);
    expect(cmp.stale).toBe(true);
    expect(cmp.changedFields).toHaveLength(1);
    expect(cmp.changedFields[0]!.label).toContain("v2".slice(-6));
  });

  it("ignore une variante absente de `current` (ex. supprimée depuis) plutôt que de la traiter comme un changement", () => {
    const snap = buildMultiStockSnapshot({
      productId: "p1",
      variantIds: ["v1", "v2"],
      variants: [
        { variantId: "v1", currentStock: 0, dailyVelocity: 1.2 },
        { variantId: "v2", currentStock: 0, dailyVelocity: 1.2 },
      ],
    });
    const current = new Map([["v1", { currentStock: 0, dailyVelocity: 1.2 }]]); // v2 absente
    expect(compareMultiStockSnapshot(snap, current).stale).toBe(false);
  });

  it("produit un message explicite mentionnant la variante concernée, distinct du message mono-variante", () => {
    const snap = buildMultiStockSnapshot({
      productId: "p1",
      variantIds: ["v1", "v2"],
      variants: [
        { variantId: "v1", currentStock: 0, dailyVelocity: 1.2 },
        { variantId: "v2", currentStock: 0, dailyVelocity: 1.2 },
      ],
    });
    const current = new Map([
      ["v1", { currentStock: 0, dailyVelocity: 1.2 }],
      ["v2", { currentStock: 5, dailyVelocity: 1.2 }],
    ]);
    const message = describeMultiStockSnapshotChange(compareMultiStockSnapshot(snap, current));
    expect(message).toContain("au moins une variante");
    expect(message).toContain("v2".slice(-6));
  });
});
