import { describe, it, expect } from "vitest";
import { mapLineItem, mapOrder } from "@/lib/integrations/shopify";

// Forme réelle observée sur la boutique (commande #1001, 04/08/2026) —
// mêmes champs que ceux demandés par ORDERS_QUERY / la bulk operation.
const RAW_LINE = {
  id: "gid://shopify/LineItem/37031402471759",
  quantity: 1,
  currentQuantity: 1,
  originalTotalSet: { shopMoney: { amount: "29.9" } },
  discountedTotalSet: { shopMoney: { amount: "29.9" } },
  product: { id: "gid://shopify/Product/16254393975119" },
  variant: { id: "gid://shopify/ProductVariant/58366061019471" },
};

const RAW_ORDER = {
  id: "gid://shopify/Order/12784679485775",
  name: "#1001",
  createdAt: "2026-08-04T19:53:47Z",
  cancelledAt: null,
  displayFinancialStatus: "PAID",
  currentTotalPriceSet: { shopMoney: { amount: "34.8", currencyCode: "EUR" } },
  totalRefundedSet: { shopMoney: { amount: "0.0" } },
};

describe("mapLineItem — ligne de commande avec variante", () => {
  it("conserve la variante, la quantité courante et les deux montants (avant / après remises)", () => {
    const li = mapLineItem(RAW_LINE);
    expect(li.variantId).toBe("gid://shopify/ProductVariant/58366061019471");
    expect(li.productId).toBe("gid://shopify/Product/16254393975119");
    expect(li.quantity).toBe(1);
    expect(li.currentQuantity).toBe(1);
    expect(li.originalTotal).toBe(29.9);
    expect(li.discountedTotal).toBe(29.9);
  });

  it("garde variantId/productId à null quand la variante ou le produit ont été supprimés côté Shopify (jamais inventés)", () => {
    const li = mapLineItem({ ...RAW_LINE, product: null, variant: null });
    expect(li.variantId).toBeNull();
    expect(li.productId).toBeNull();
  });
});

describe("mapOrder — entité commande", () => {
  it("distingue total commande, montant remboursé (conservé, jamais déduit) et annulation", () => {
    const o = mapOrder(RAW_ORDER, [RAW_LINE]);
    expect(o.name).toBe("#1001");
    expect(o.totalPrice).toBe(34.8);
    expect(o.totalRefunded).toBe(0);
    expect(o.cancelledAt).toBeNull();
    expect(o.financialStatus).toBe("PAID");
    expect(o.currencyCode).toBe("EUR");
    expect(o.lineItems).toHaveLength(1);
    // Le total commande (34.80, port inclus) n'est PAS la somme des lignes
    // (29.90) : les deux sont conservés séparément, aucun n'est recalculé.
    expect(o.totalPrice).not.toBe(o.lineItems[0]!.discountedTotal);
  });

  it("conserve une annulation telle quelle pour que l'agrégat de ventes puisse l'exclure", () => {
    const o = mapOrder({ ...RAW_ORDER, cancelledAt: "2026-08-05T10:00:00Z", displayFinancialStatus: "VOIDED" }, [RAW_LINE]);
    expect(o.cancelledAt).toBe("2026-08-05T10:00:00Z");
  });
});
