import { describe, it, expect, afterEach, vi } from "vitest";
import { fetchAllProducts, fetchRecentOrders, verifyPrestaShopCredentials, type PrestaShopCredentials } from "@/lib/integrations/prestashop";

// CONNECTEUR PRESTASHOP (04/09/2026). Construit sans boutique réelle pour
// vérifier en direct (voir avertissement en tête de prestashop.ts) — ces
// tests figent les hypothèses de mapping les plus sensibles : le prix d'une
// combinaison est un IMPACT (delta) à additionner au prix produit, pas un
// prix absolu ; les champs multilingues peuvent revenir en chaîne simple OU
// en tableau {id,value} ; la détection "annulé" repose sur le libellé de
// l'état de commande.

const REAL_FETCH = global.fetch;
const CREDS: PrestaShopCredentials = { siteUrl: "https://ma-boutique.fr", apiKey: "PSWSKEY123" };

/** Route les requêtes par ressource (chemin) plutôt que par ordre d'appel —
 * fetchAllProducts/fetchRecentOrders lancent plusieurs collections en
 * parallèle (Promise.all), l'ordre des appels fetch n'est pas garanti. */
function mockFetchByResource(byPath: Record<string, unknown>) {
  global.fetch = vi.fn().mockImplementation(async (url: string) => {
    const u = new URL(url);
    for (const [path, body] of Object.entries(byPath)) {
      if (u.pathname === path) return { ok: true, status: 200, json: async () => body };
    }
    throw new Error(`URL non mockée dans ce test: ${url}`);
  }) as unknown as typeof fetch;
}

afterEach(() => {
  global.fetch = REAL_FETCH;
  vi.restoreAllMocks();
});

describe("authHeader / verifyPrestaShopCredentials", () => {
  it("envoie un en-tête Authorization Basic (clé Webservice + mot de passe vide) et demande output_format=JSON", async () => {
    mockFetchByResource({ "/api/shops": { shops: [] } });
    await verifyPrestaShopCredentials(CREDS);
    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const url = call[0] as string;
    const opts = call[1] as { headers: Record<string, string> };
    const expected = `Basic ${Buffer.from("PSWSKEY123:").toString("base64")}`;
    expect(opts.headers.authorization).toBe(expected);
    expect(new URL(url).searchParams.get("output_format")).toBe("JSON");
  });
});

describe("fetchAllProducts — produit sans combinaison", () => {
  it("mappe un produit simple, avec un champ nom en chaîne simple", async () => {
    mockFetchByResource({
      "/api/products": {
        products: [
          {
            id: 7,
            link_rewrite: "chaise-bois",
            name: "Chaise en bois",
            active: "1",
            reference: "CHR-001",
            price: "49.90",
            wholesale_price: "22.00",
            id_category_default: "3",
            date_add: "2026-01-15 10:00:00",
          },
        ],
      },
      "/api/combinations": { combinations: [] },
      "/api/stock_availables": { stock_availables: [{ id_product: 7, id_product_attribute: 0, quantity: "8" }] },
      "/api/categories": { categories: [{ id: 3, name: "Mobilier" }] },
      "/api/product_option_values": { product_option_values: [] },
    });

    const [product] = await fetchAllProducts(CREDS);

    expect(product).toMatchObject({ id: "7", handle: "chaise-bois", title: "Chaise en bois", status: "active", productType: "Mobilier" });
    expect(product!.variants.nodes).toHaveLength(1);
    expect(product!.variants.nodes[0]).toMatchObject({ id: "7", price: "49.90", sku: "CHR-001", inventoryQuantity: 8 });
    expect(product!.variants.nodes[0]!.inventoryItem).toMatchObject({ unitCost: { amount: "22.00" } });
  });

  it("accepte un champ multilingue au format tableau [{id,value}]", async () => {
    mockFetchByResource({
      "/api/products": {
        products: [
          {
            id: 8,
            link_rewrite: [{ id: "1", value: "produit-multilingue" }],
            name: [{ id: "1", value: "Produit multilingue" }],
            active: "1",
            reference: "M1",
            price: "10.00",
            wholesale_price: "",
            id_category_default: "2",
            date_add: "2026-01-01",
          },
        ],
      },
      "/api/combinations": { combinations: [] },
      "/api/stock_availables": { stock_availables: [] },
      "/api/categories": { categories: [] },
      "/api/product_option_values": { product_option_values: [] },
    });
    const [product] = await fetchAllProducts(CREDS);
    expect(product).toMatchObject({ handle: "produit-multilingue", title: "Produit multilingue" });
  });

  it("wholesale_price absent (chaîne vide) → unitCost null, jamais 0", async () => {
    mockFetchByResource({
      "/api/products": {
        products: [{ id: 9, link_rewrite: "x", name: "X", active: "1", reference: "X", price: "5.00", wholesale_price: "", id_category_default: "1", date_add: "2026-01-01" }],
      },
      "/api/combinations": { combinations: [] },
      "/api/stock_availables": { stock_availables: [] },
      "/api/categories": { categories: [] },
      "/api/product_option_values": { product_option_values: [] },
    });
    const [product] = await fetchAllProducts(CREDS);
    expect(product!.variants.nodes[0]!.inventoryItem).toBeNull();
  });

  it("produit inactif (active='0') → status draft", async () => {
    mockFetchByResource({
      "/api/products": {
        products: [{ id: 11, link_rewrite: "y", name: "Y", active: "0", reference: "Y", price: "5.00", wholesale_price: "", id_category_default: "1", date_add: "2026-01-01" }],
      },
      "/api/combinations": { combinations: [] },
      "/api/stock_availables": { stock_availables: [] },
      "/api/categories": { categories: [] },
      "/api/product_option_values": { product_option_values: [] },
    });
    const [product] = await fetchAllProducts(CREDS);
    expect(product!.status).toBe("draft");
  });
});

describe("fetchAllProducts — produit avec combinaisons (le prix de combinaison est un IMPACT, pas un prix absolu)", () => {
  it("additionne le prix produit et l'impact de la combinaison pour obtenir le prix final", async () => {
    mockFetchByResource({
      "/api/products": {
        products: [{ id: 20, link_rewrite: "tshirt", name: "T-shirt", active: "1", reference: "TS", price: "15.00", wholesale_price: "6.00", id_category_default: "1", date_add: "2026-01-01" }],
      },
      "/api/combinations": {
        combinations: [
          { id: 201, id_product: 20, reference: "TS-R-M", price: "0.00", associations: { product_option_values: [{ id: 1 }, { id: 10 }] } },
          { id: 202, id_product: 20, reference: "TS-R-L", price: "2.50", associations: { product_option_values: [{ id: 1 }, { id: 11 }] } },
        ],
      },
      "/api/stock_availables": {
        stock_availables: [
          { id_product: 20, id_product_attribute: 201, quantity: "4" },
          { id_product: 20, id_product_attribute: 202, quantity: "0" },
        ],
      },
      "/api/categories": { categories: [] },
      "/api/product_option_values": { product_option_values: [{ id: 1, name: "Rouge" }, { id: 10, name: "M" }, { id: 11, name: "L" }] },
    });

    const [product] = await fetchAllProducts(CREDS);
    expect(product!.variants.nodes).toHaveLength(2);
    const variantM = product!.variants.nodes.find((v) => v.id === "201")!;
    const variantL = product!.variants.nodes.find((v) => v.id === "202")!;
    // Prix produit 15.00 + impact 0.00 = 15.00 ; prix produit 15.00 + impact 2.50 = 17.50.
    expect(variantM.price).toBe("15.00");
    expect(variantL.price).toBe("17.50");
    expect(variantM.title).toBe("Rouge / M");
    expect(variantM.inventoryQuantity).toBe(4);
    expect(variantL.inventoryQuantity).toBe(0);
    // Coût d'achat du produit parent appliqué à chaque combinaison (pas de coût par combinaison lu ici).
    expect(variantM.inventoryItem).toMatchObject({ unitCost: { amount: "6.00" } });
  });
});

describe("fetchRecentOrders — détection d'annulation par libellé d'état, et lignes de commande", () => {
  it("détecte une commande annulée via le libellé de l'état (français)", async () => {
    mockFetchByResource({
      "/api/orders": {
        orders: [
          {
            id: 100,
            reference: "ABCDE",
            id_currency: "1",
            current_state: "6",
            date_add: "2026-09-01 10:00:00",
            date_upd: "2026-09-01 11:00:00",
            total_paid: "50.00",
            total_paid_real: "50.00",
            associations: { order_rows: [] },
          },
        ],
      },
      "/api/order_states": { order_states: [{ id: 6, name: "Annulée" }] },
      "/api/currencies": { currencies: [{ id: 1, iso_code: "EUR" }] },
    });
    const [order] = await fetchRecentOrders(CREDS, 90);
    expect(order!.cancelledAt).toBe("2026-09-01 11:00:00");
    expect(order!.financialStatus).toBe("annulée");
  });

  it("un état au libellé non reconnu n'est JAMAIS traité comme annulé (par défaut : pas annulé)", async () => {
    mockFetchByResource({
      "/api/orders": {
        orders: [
          {
            id: 101,
            reference: "FGHIJ",
            id_currency: "1",
            current_state: "99",
            date_add: "2026-09-01",
            date_upd: "2026-09-01",
            total_paid: "10.00",
            total_paid_real: "10.00",
            associations: { order_rows: [] },
          },
        ],
      },
      "/api/order_states": { order_states: [{ id: 99, name: "État personnalisé étrange" }] },
      "/api/currencies": { currencies: [{ id: 1, iso_code: "EUR" }] },
    });
    const [order] = await fetchRecentOrders(CREDS, 90);
    expect(order!.cancelledAt).toBeNull();
  });

  it("calcule totalRefunded = total_paid - total_paid_real quand un écart existe, sinon null", async () => {
    mockFetchByResource({
      "/api/orders": {
        orders: [
          {
            id: 102,
            reference: "KLMNO",
            id_currency: "1",
            current_state: "2",
            date_add: "2026-09-01",
            date_upd: "2026-09-01",
            total_paid: "100.00",
            total_paid_real: "70.00",
            associations: { order_rows: [] },
          },
        ],
      },
      "/api/order_states": { order_states: [{ id: 2, name: "Paiement accepté" }] },
      "/api/currencies": { currencies: [{ id: 1, iso_code: "EUR" }] },
    });
    const [order] = await fetchRecentOrders(CREDS, 90);
    expect(order!.totalRefunded).toBe(30);
  });

  it("mappe les lignes de commande : originalTotal = prix unitaire × quantité, discountedTotal = total_price_tax_excl", async () => {
    mockFetchByResource({
      "/api/orders": {
        orders: [
          {
            id: 103,
            reference: "PQRST",
            id_currency: "1",
            current_state: "2",
            date_add: "2026-09-01",
            date_upd: "2026-09-01",
            total_paid: "27.00",
            total_paid_real: "27.00",
            associations: {
              order_rows: [{ id: 1, product_id: "50", product_attribute_id: "0", product_quantity: "3", product_price: "10.00", total_price_tax_excl: "27.00" }],
            },
          },
        ],
      },
      "/api/order_states": { order_states: [{ id: 2, name: "Paiement accepté" }] },
      "/api/currencies": { currencies: [{ id: 1, iso_code: "EUR" }] },
    });
    const [order] = await fetchRecentOrders(CREDS, 90);
    expect(order!.lineItems[0]).toMatchObject({ productId: "50", variantId: "50", quantity: 3, originalTotal: 30, discountedTotal: 27 });
  });

  it("ligne avec combinaison (product_attribute_id renseigné) → variantId = product_attribute_id", async () => {
    mockFetchByResource({
      "/api/orders": {
        orders: [
          {
            id: 104,
            reference: "UVWXY",
            id_currency: "1",
            current_state: "2",
            date_add: "2026-09-01",
            date_upd: "2026-09-01",
            total_paid: "20.00",
            total_paid_real: "20.00",
            associations: {
              order_rows: [{ id: 1, product_id: "20", product_attribute_id: "201", product_quantity: "1", product_price: "20.00", total_price_tax_excl: "20.00" }],
            },
          },
        ],
      },
      "/api/order_states": { order_states: [{ id: 2, name: "Paiement accepté" }] },
      "/api/currencies": { currencies: [{ id: 1, iso_code: "EUR" }] },
    });
    const [order] = await fetchRecentOrders(CREDS, 90);
    expect(order!.lineItems[0]).toMatchObject({ productId: "20", variantId: "201" });
  });
});
