import { prisma } from "@/lib/db";
import { recomputeStoreIntelligence } from "@/lib/intelligence/pipeline";

// PHASE 20 — Mode Démo. Jeu de données clairement fictif (isDemo: true),
// jamais mélangé aux vraies données d'une boutique connectée. Sert
// uniquement à faire découvrir l'application avant de connecter une vraie
// boutique (voir onboarding). Les produits sont explicitement inventés pour
// la démonstration — PAS des données OnDeal.fr réelles.
const DEMO_PRODUCTS = [
  {
    title: "[DÉMO] Casque audio sans fil",
    productType: "High-tech",
    price: 39.9,
    compareAtPrice: 59.9,
    storeStock: 0,
    supplierStock: 120,
    supplierCost: 14,
    shippingCost: 3.5,
    unitsSoldLast30d: 42,
    reviews: [{ rating: 5, title: "Très bon son", body: "Livraison rapide, très satisfait." }],
  },
  {
    title: "[DÉMO] Lampe de bureau LED",
    productType: "Maison",
    price: 24.9,
    compareAtPrice: null,
    storeStock: 3,
    supplierStock: 400,
    supplierCost: 9,
    shippingCost: 2.2,
    unitsSoldLast30d: 30,
    reviews: [],
  },
  {
    title: "[DÉMO] Tapis de sport antidérapant",
    productType: "Sport",
    price: 19.9,
    compareAtPrice: null,
    storeStock: 85,
    supplierStock: 200,
    supplierCost: 17,
    shippingCost: 4,
    unitsSoldLast30d: 2,
    reviews: [
      { rating: 2, title: "Déçu", body: "Qualité en dessous de mes attentes, le tapis glisse un peu." },
      { rating: 2, title: "Moyen", body: "Prix correct mais qualité moyenne." },
    ],
  },
  {
    title: "[DÉMO] Montre connectée sport",
    productType: "High-tech",
    price: 49.9,
    compareAtPrice: 79.9,
    storeStock: 18,
    supplierStock: 60,
    supplierCost: 22,
    shippingCost: 3,
    unitsSoldLast30d: 25,
    reviews: [
      { rating: 5, title: "Excellent", body: "Très pratique, autonomie au top." },
      { rating: 4, title: "Très bien", body: "Bon rapport qualité-prix, livraison rapide." },
      { rating: 5, title: "Parfait", body: "Exactement ce qu'il me fallait." },
    ],
  },
];

export async function seedDemoStore(organizationId: string): Promise<string> {
  const store = await prisma.store.create({
    data: { organizationId, name: "Boutique de démonstration", isDemo: true, currency: "EUR" },
  });

  for (let i = 0; i < DEMO_PRODUCTS.length; i++) {
    const d = DEMO_PRODUCTS[i]!;
    const product = await prisma.product.create({
      data: {
        storeId: store.id,
        shopifyProductId: `demo-${i}`,
        handle: `demo-produit-${i}`,
        title: d.title,
        status: "active",
        productType: d.productType,
        vendor: "Démonstration",
      },
    });

    await prisma.variant.create({
      data: {
        productId: product.id,
        shopifyVariantId: `demo-variant-${i}`,
        title: "Default",
        price: d.price,
        compareAtPrice: d.compareAtPrice,
        inventoryQuantity: d.storeStock,
        supplierStock: d.supplierStock,
      },
    });

    await prisma.costAssumption.create({
      data: {
        storeId: store.id,
        productId: product.id,
        supplierCost: d.supplierCost,
        shippingCost: d.shippingCost,
        paymentFeesRate: 0.029,
      },
    });

    await prisma.salesSnapshot.create({
      data: { productId: product.id, date: new Date(), unitsSold: d.unitsSoldLast30d, revenue: d.unitsSoldLast30d * d.price },
    });

    for (let j = 0; j < d.reviews.length; j++) {
      const r = d.reviews[j]!;
      await prisma.review.create({
        data: {
          storeId: store.id,
          productId: product.id,
          externalId: `demo-${i}-${j}`,
          rating: r.rating,
          title: r.title,
          body: r.body,
          authorName: "Client démo",
          verifiedPurchase: true,
          publishedAt: new Date(),
        },
      });
    }
  }

  await recomputeStoreIntelligence(store.id);

  return store.id;
}
