// PHASE 11 — Marketing Intelligence. Détection d'opportunités marketing et
// génération de contenu (posts, accroches, descriptions) STRICTEMENT à
// partir de données produit réelles fournies en entrée. Aucune
// caractéristique produit n'est inventée : si une donnée (ex. avis,
// promotion) est absente, elle est simplement omise du texte généré plutôt
// que remplacée par une valeur plausible mais fausse.

export interface MarketingProductInput {
  productId: string;
  title: string;
  productType: string | null;
  price: number | null;
  compareAtPrice: number | null;
  marginRate: number | null;
  averageRating: number | null;
  reviewCount: number;
  score: number;
  daysOfStock: number | null;
}

export interface MarketingOpportunity {
  productId: string;
  title: string;
  score: number;
  reason: string;
  audience: string;
  channel: "TikTok" | "Instagram" | "Facebook" | "Pinterest" | "YouTube";
  angle: string;
  offer: string | null;
}

export function detectMarketingOpportunities(products: MarketingProductInput[]): MarketingOpportunity[] {
  const opportunities: MarketingOpportunity[] = [];

  for (const p of products) {
    const reasons: string[] = [];
    let channel: MarketingOpportunity["channel"] = "Instagram";
    let angle = "Mise en avant produit";

    if (p.marginRate !== null && p.marginRate >= 0.4) {
      reasons.push(`forte marge (${(p.marginRate * 100).toFixed(0)}%)`);
    }
    if (p.averageRating !== null && p.averageRating >= 4.5 && p.reviewCount >= 5) {
      reasons.push(`excellente note (${p.averageRating.toFixed(1)}/5 sur ${p.reviewCount} avis)`);
      angle = "Preuve sociale — avis clients vérifiés";
      channel = "Facebook";
    }
    if (p.daysOfStock !== null && p.daysOfStock >= 90) {
      reasons.push("surstock à écouler");
      angle = "Offre limitée pour accélérer l'écoulement";
      channel = "TikTok";
    }
    if (p.score >= 80) {
      reasons.push(`OnDeal Score élevé (${p.score}/100)`);
    }

    if (reasons.length === 0) continue;

    const hasPromo = p.compareAtPrice !== null && p.price !== null && p.compareAtPrice > p.price;

    opportunities.push({
      productId: p.productId,
      title: p.title,
      score: p.score,
      reason: reasons.join(", "),
      audience: p.productType ? `Acheteurs intéressés par : ${p.productType}` : "Audience générale OnDeal.fr",
      channel,
      angle,
      offer: hasPromo && p.price !== null && p.compareAtPrice !== null
        ? `${Math.round((1 - p.price / p.compareAtPrice) * 100)}% de réduction (${p.price.toFixed(2)} € au lieu de ${p.compareAtPrice.toFixed(2)} €)`
        : null,
    });
  }

  return opportunities.sort((a, b) => b.score - a.score);
}

export type ContentFormat = "post_court" | "accroche" | "description" | "script_video";

/**
 * Génère un texte marketing gabarité à partir des VRAIES données du
 * produit. Les champs indisponibles sont omis (jamais remplacés par une
 * caractéristique inventée). Retourne aussi la liste des champs qui
 * auraient enrichi le texte s'ils avaient été disponibles.
 */
export function generateMarketingContent(
  product: MarketingProductInput,
  format: ContentFormat,
): { text: string; missingData: string[] } {
  const missing: string[] = [];
  const priceText =
    product.price !== null
      ? product.compareAtPrice !== null && product.compareAtPrice > product.price
        ? `${product.price.toFixed(2)} € au lieu de ${product.compareAtPrice.toFixed(2)} €`
        : `${product.price.toFixed(2)} €`
      : (missing.push("price"), "[prix non disponible]");

  const ratingText =
    product.averageRating !== null && product.reviewCount > 0
      ? `noté ${product.averageRating.toFixed(1)}/5 par ${product.reviewCount} client${product.reviewCount > 1 ? "s" : ""}`
      : (missing.push("rating"), null);

  switch (format) {
    case "accroche":
      return {
        text: ratingText
          ? `${product.title} — ${ratingText}. À découvrir sur OnDeal.fr.`
          : `${product.title} — À découvrir sur OnDeal.fr.`,
        missingData: missing,
      };
    case "post_court":
      return {
        text: [
          `✨ ${product.title}`,
          ratingText ? `⭐ ${ratingText}` : null,
          `💶 ${priceText}`,
          `👉 Disponible sur OnDeal.fr`,
        ]
          .filter(Boolean)
          .join("\n"),
        missingData: missing,
      };
    case "description":
      return {
        text: `${product.title}${product.productType ? ` (${product.productType})` : ""} — ${priceText}${ratingText ? `, ${ratingText}` : ""}. Livraison offerte et retours 14 jours sur OnDeal.fr.`,
        missingData: missing,
      };
    case "script_video":
      return {
        text: [
          `[Plan 1 — Accroche] "${product.title} : ${ratingText ?? "un incontournable"}."`,
          `[Plan 2 — Produit] Montrer le produit en situation réelle (photo/vidéo catalogue à insérer).`,
          `[Plan 3 — Prix/CTA] "${priceText}, dispo maintenant sur OnDeal.fr."`,
        ].join("\n"),
        missingData: missing,
      };
  }
}
