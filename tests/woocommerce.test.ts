import { describe, it, expect, afterEach, vi } from "vitest";
import { fetchAllProducts, fetchRecentOrders, verifyWooCommerceCredentials, type WooCommerceCredentials } from "@/lib/integrations/woocommerce";

// CONNECTEUR WOOCOMMERCE (04/09/2026). Ces tests verrouillent le mapping
// vers la forme ShopifyProductNode/ShopifyOrderNode (voir woocommerce.ts
// pour la justification) contre des réponses conformes à la documentation
// officielle WooCommerce REST API v3 — construit sans boutique réelle pour
// vérifier en direct, donc particulièrement important de figer ces
// hypothèses de mapping dans des tests explicites.

const REAL_FETCH = global.fetch;
const CREDS: WooCommerceCredentials = { siteUrl: "https://ma-boutique.com", consumerKey: "ck_test", consumerSecret: "cs_test" };

function mockFetchSequence(responses: Array<{ status: number; body: unknown }>) {
  let call = 0;
  global.fetch = vi.fn().mockImplementation(async () => {
    const r = responses[Math.min(call, responses.length - 1)]!;
    call += 1;
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body };
  }) as unknown as typeof fetch;
}

afterEach(() => {
  global.fetch = REAL_FETCH;
  vi.restoreAllMocks();
});

describe("authHeader / verifyWooCommerceCredentials", () => {
  it("envoie un en-tête Authorization Basic (clé:secret encodé base64)", async () => {
    mockFetchSequence([{ status: 200, body: { environment: { site_url: "https://ma-boutique.com" } } }]);
    await verifyWooCommerceCredentials(CREDS);
    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const headers = call[1].headers as Record<string, string>;
    const expected = `Basic ${Buffer.from("ck_test:cs_test").toString("base64")}`;
    expect(headers.authorization).toBe(expected);
  });

  it("lève une erreur si le statut HTTP n'est pas ok", async () => {
    mockFetchSequence([{ status: 401, body: {} }]);
    await expect(verifyWooCommerceCredentials(CREDS)).rejects.toThrow(/401/);
  });
});

describe("fetchAllProducts — mapping produit simple", () => {
  it("traite un produit sans variation comme un pseudo-variant portant l'id du produit", async () => {
    mockFetchSequence([
      {
        status: 200,
        body: [
          {
            id: 42,
            name: "T-shirt uni",
            slug: "t-shirt-uni",
            status: "publish",
            type: "simple",
            categories: [{ id: 1, name: "Vêtements" }],
            date_created: "2026-01-01T10:00:00",
            images: [{ src: "https://ma-boutique.com/img.jpg" }],
            sku: "TSH-001",
            price: "19.99",
            regular_price: "19.99",
            sale_price: "",
            on_sale: false,
            manage_stock: true,
            stock_quantity: 12,
          },
        ],
      },
      { status: 200, body: [] }, // page suivante vide → arrêt de la pagination
    ]);

    const products = await fetchAllProducts(CREDS);

    expect(products).toHaveLength(1);
    expect(products[0]).toMatchObject({ id: "42", handle: "t-shirt-uni", title: "T-shirt uni", status: "active", productType: "Vêtements" });
    expect(products[0]!.variants.nodes).toHaveLength(1);
    expect(products[0]!.variants.nodes[0]).toMatchObject({
      id: "42", // même id que le produit — convention pseudo-variant
      sku: "TSH-001",
      price: "19.99",
      compareAtPrice: null,
      inventoryQuantity: 12,
      inventoryItem: null, // aucun champ coût natif WooCommerce
    });
  });

  it("calcule compareAtPrice comme le prix régulier UNIQUEMENT quand le produit est en promotion", async () => {
    mockFetchSequence([
      {
        status: 200,
        body: [
          {
            id: 1,
            name: "Promo",
            slug: "promo",
            status: "publish",
            type: "simple",
            date_created: "2026-01-01T10:00:00",
            sku: "P1",
            price: "15.00",
            regular_price: "20.00",
            sale_price: "15.00",
            on_sale: true,
            manage_stock: true,
            stock_quantity: 5,
          },
        ],
      },
      { status: 200, body: [] },
    ]);
    const [product] = await fetchAllProducts(CREDS);
    expect(product!.variants.nodes[0]).toMatchObject({ price: "15.00", compareAtPrice: "20.00" });
  });

  it("stock non suivi (manage_stock=false) → inventoryQuantity null, jamais 0", async () => {
    mockFetchSequence([
      {
        status: 200,
        body: [
          {
            id: 2,
            name: "Illimité",
            slug: "illimite",
            status: "publish",
            type: "simple",
            date_created: "2026-01-01T10:00:00",
            sku: "U1",
            price: "5.00",
            regular_price: "5.00",
            sale_price: "",
            on_sale: false,
            manage_stock: false,
            stock_quantity: null,
          },
        ],
      },
      { status: 200, body: [] },
    ]);
    const [product] = await fetchAllProducts(CREDS);
    expect(product!.variants.nodes[0]!.inventoryQuantity).toBeNull();
  });

  it("statut 'private' → archived, tout autre statut inconnu → draft", async () => {
    mockFetchSequence([
      {
        status: 200,
        body: [
          { id: 3, name: "A", slug: "a", status: "private", type: "simple", date_created: "2026-01-01", sku: "A", price: "1", regular_price: "1", sale_price: "", on_sale: false, manage_stock: false, stock_quantity: null },
          { id: 4, name: "B", slug: "b", status: "pending", type: "simple", date_created: "2026-01-01", sku: "B", price: "1", regular_price: "1", sale_price: "", on_sale: false, manage_stock: false, stock_quantity: null },
        ],
      },
      { status: 200, body: [] },
    ]);
    const products = await fetchAllProducts(CREDS);
    expect(products.find((p) => p.id === "3")!.status).toBe("archived");
    expect(products.find((p) => p.id === "4")!.status).toBe("draft");
  });

  it("produit variable : va chercher les variations sur /products/{id}/variations et construit un titre depuis les attributs", async () => {
    mockFetchSequence([
      {
        status: 200,
        body: [
          {
            id: 10,
            name: "T-shirt",
            slug: "t-shirt",
            status: "publish",
            type: "variable",
            date_created: "2026-01-01T10:00:00",
            sku: "",
            price: "0",
            regular_price: "0",
            sale_price: "",
            on_sale: false,
            manage_stock: false,
            stock_quantity: null,
            variations: [101, 102],
          },
        ],
      },
      // Pas de deuxième appel /products : la première page renvoie moins de
      // PER_PAGE éléments, donc fetchAllProducts s'arrête là pour les produits
      // avant même de regarder les variations (voir la boucle dans woocommerce.ts).
      {
        status: 200,
        body: [
          { id: 101, sku: "TSH-R-M", price: "19.99", regular_price: "19.99", sale_price: "", on_sale: false, manage_stock: true, stock_quantity: 3, attributes: [{ name: "Couleur", option: "Rouge" }, { name: "Taille", option: "M" }] },
        ],
      },
      // Pas de deuxième appel /variations non plus, même raison (1 < PER_PAGE).
    ]);

    const [product] = await fetchAllProducts(CREDS);
    expect(product!.variants.nodes).toHaveLength(1);
    expect(product!.variants.nodes[0]).toMatchObject({ id: "101", title: "Rouge / M", sku: "TSH-R-M", inventoryQuantity: 3 });
  });
});

describe("fetchRecentOrders — mapping commande", () => {
  it("mappe une commande simple avec une ligne sur un produit sans variation", async () => {
    mockFetchSequence([
      {
        status: 200,
        body: [
          {
            id: 555,
            status: "processing",
            date_created: "2026-09-01T12:00:00",
            date_modified: "2026-09-01T12:00:00",
            currency: "EUR",
            total: "39.98",
            line_items: [{ id: 1, product_id: 42, variation_id: 0, quantity: 2, subtotal: "39.98", total: "39.98" }],
          },
        ],
      },
      { status: 200, body: [] },
    ]);
    const [order] = await fetchRecentOrders(CREDS, 90);
    expect(order).toMatchObject({ id: "555", cancelledAt: null, financialStatus: "processing", currencyCode: "EUR", totalPrice: 39.98, totalRefunded: null });
    expect(order!.lineItems[0]).toMatchObject({ productId: "42", variantId: "42", quantity: 2, originalTotal: 39.98, discountedTotal: 39.98 });
  });

  it("commande annulée (status=cancelled) → cancelledAt renseigné", async () => {
    mockFetchSequence([
      {
        status: 200,
        body: [
          { id: 1, status: "cancelled", date_created: "2026-09-01", date_modified: "2026-09-02", currency: "EUR", total: "10", line_items: [] },
        ],
      },
      { status: 200, body: [] },
    ]);
    const [order] = await fetchRecentOrders(CREDS, 90);
    expect(order!.cancelledAt).toBe("2026-09-02");
  });

  it("somme les remboursements (valeur absolue) en totalRefunded", async () => {
    mockFetchSequence([
      {
        status: 200,
        body: [
          {
            id: 1,
            status: "refunded",
            date_created: "2026-09-01",
            date_modified: "2026-09-02",
            currency: "EUR",
            total: "50",
            line_items: [],
            refunds: [{ id: 1, total: "-20" }, { id: 2, total: "-5" }],
          },
        ],
      },
      { status: 200, body: [] },
    ]);
    const [order] = await fetchRecentOrders(CREDS, 90);
    expect(order!.totalRefunded).toBe(25);
  });

  it("ligne sur une variation : variantId = variation_id, productId = product_id (le parent)", async () => {
    mockFetchSequence([
      {
        status: 200,
        body: [
          {
            id: 1,
            status: "completed",
            date_created: "2026-09-01",
            date_modified: "2026-09-01",
            currency: "EUR",
            total: "20",
            line_items: [{ id: 1, product_id: 10, variation_id: 101, quantity: 1, subtotal: "20", total: "20" }],
          },
        ],
      },
      { status: 200, body: [] },
    ]);
    const [order] = await fetchRecentOrders(CREDS, 90);
    expect(order!.lineItems[0]).toMatchObject({ productId: "10", variantId: "101" });
  });
});
