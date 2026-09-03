import type { ReviewAnalysis, ReviewThemeMention } from "@/types";

export interface ReviewRecord {
  productId: string | null;
  rating: number;
  title: string | null;
  body: string | null;
  publishedAt: Date;
}

// Dictionnaire de thèmes (PHASE 7) : mots-clés recherchés dans le texte réel
// des avis. Approche déterministe (pas d'invention) — un thème n'apparaît
// que si un vrai mot-clé a été trouvé dans un vrai texte d'avis.
const THEME_KEYWORDS: Record<string, string[]> = {
  livraison: ["livraison", "livré", "delivery", "colis", "expédition", "transporteur"],
  qualite: ["qualité", "solide", "cassé", "défectueux", "robuste", "fragile"],
  emballage: ["emballage", "carton", "boîte", "packaging"],
  prix: ["prix", "cher", "rapport qualité-prix", "abordable"],
  utilisation: ["facile", "utiliser", "pratique", "utilisation", "usage"],
  sav: ["sav", "service client", "support", "remboursement", "retour"],
};

function detectSentimentForRating(rating: number): "positif" | "negatif" | "mixte" {
  if (rating >= 4) return "positif";
  if (rating <= 2) return "negatif";
  return "mixte";
}

export function analyzeReviews(params: {
  storeId: string;
  reviews: ReviewRecord[];
  totalProductCount: number;
  now?: Date;
}): ReviewAnalysis {
  const { storeId, reviews, totalProductCount } = params;
  const now = params.now ?? new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const totalReviews = reviews.length;
  const averageRating =
    totalReviews > 0 ? reviews.reduce((sum, r) => sum + r.rating, 0) / totalReviews : null;

  const recentReviews = reviews.filter((r) => r.publishedAt >= thirtyDaysAgo).length;
  const positiveCount = reviews.filter((r) => r.rating >= 4).length;
  const negativeCount = reviews.filter((r) => r.rating <= 2).length;

  const reviewedProductIds = new Set(reviews.filter((r) => r.productId).map((r) => r.productId as string));
  const reviewCountByProduct = new Map<string, number>();
  for (const r of reviews) {
    if (!r.productId) continue;
    reviewCountByProduct.set(r.productId, (reviewCountByProduct.get(r.productId) ?? 0) + 1);
  }
  const productsWithoutReviews = Math.max(0, totalProductCount - reviewedProductIds.size);
  const productsWithFewReviews = [...reviewCountByProduct.values()].filter((c) => c > 0 && c < 5).length;

  const themeCounts = new Map<string, { count: number; positive: number; negative: number }>();
  for (const r of reviews) {
    const text = `${r.title ?? ""} ${r.body ?? ""}`.toLowerCase();
    if (!text.trim()) continue;
    for (const [theme, keywords] of Object.entries(THEME_KEYWORDS)) {
      if (keywords.some((kw) => text.includes(kw))) {
        const entry = themeCounts.get(theme) ?? { count: 0, positive: 0, negative: 0 };
        entry.count += 1;
        if (r.rating >= 4) entry.positive += 1;
        if (r.rating <= 2) entry.negative += 1;
        themeCounts.set(theme, entry);
      }
    }
  }

  const themes: ReviewThemeMention[] = [...themeCounts.entries()]
    .map(([theme, v]) => ({
      theme,
      count: v.count,
      sentiment:
        v.positive > v.negative * 2 ? ("positif" as const) : v.negative > v.positive * 2 ? ("negatif" as const) : ("mixte" as const),
    }))
    .sort((a, b) => b.count - a.count);

  return {
    storeId,
    totalReviews,
    averageRating,
    ratingTrend: null, // nécessite un snapshot historique — voir sync/pipeline.ts (Phase 15/16, non encore accumulé)
    recentReviews,
    positiveCount,
    negativeCount,
    productsWithoutReviews,
    productsWithFewReviews,
    themes,
  };
}

export function reviewSentimentSummary(reviews: ReviewRecord[]) {
  return reviews.reduce(
    (acc, r) => {
      const s = detectSentimentForRating(r.rating);
      acc[s] += 1;
      return acc;
    },
    { positif: 0, negatif: 0, mixte: 0 },
  );
}
