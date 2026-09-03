// PHASE 17 — Connecteur Judge.me (REST API). Réécriture multi-tenant du
// pattern déjà validé dans le projet storefront ondeal-work
// (src/lib/shopify/judgeme.ts) : jeton API PRIVÉ par boutique (jamais le
// jeton public, insuffisant pour cet usage), filtrage définitif côté
// serveur, jamais de champ personnel (email/IP du client) exposé.

export interface JudgemeCredentials {
  apiToken: string;
  shopDomain: string; // ex: my-store.myshopify.com
}

export class JudgemeApiError extends Error {}

const REVIEWS_ENDPOINT = "https://judge.me/api/v1/reviews";
const MAX_PAGES = 20; // garde-fou anti-boucle infinie
const PER_PAGE = 100;

interface JudgemeReviewerRaw {
  name: string | null;
}

interface JudgemeReviewRaw {
  id: number;
  title: string | null;
  body: string | null;
  rating: number;
  product_external_id: number | null;
  reviewer: JudgemeReviewerRaw | null;
  published: boolean;
  curated: string;
  verified: string;
  created_at: string;
}

interface JudgemeReviewsResponse {
  reviews?: JudgemeReviewRaw[];
  error?: string;
}

export interface NormalizedReview {
  externalId: string;
  productExternalId: string | null;
  rating: number;
  title: string | null;
  body: string | null;
  authorName: string | null;
  verifiedPurchase: boolean;
  publishedAt: Date;
}

export async function verifyJudgemeCredentials(creds: JudgemeCredentials): Promise<{ ok: true }> {
  const url = new URL(REVIEWS_ENDPOINT);
  url.searchParams.set("api_token", creds.apiToken);
  url.searchParams.set("shop_domain", creds.shopDomain);
  url.searchParams.set("per_page", "1");

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new JudgemeApiError(`Judge.me a répondu ${res.status} — vérifiez le jeton API privé et le domaine.`);
  }
  const json = (await res.json()) as JudgemeReviewsResponse;
  if (json.error) throw new JudgemeApiError(json.error);
  return { ok: true };
}

/**
 * Récupère tous les avis publiés de la boutique (pagination automatique,
 * plafonnée par MAX_PAGES/PER_PAGE). Ne renvoie JAMAIS l'email ou l'IP du
 * client — seuls auteur/titre/texte/note/date/statut vérifié sont exposés.
 * En cas d'échec quelconque, retourne un tableau vide plutôt que de faire
 * échouer l'appelant : le reste de l'application continue de fonctionner.
 */
export async function fetchAllReviews(creds: JudgemeCredentials): Promise<NormalizedReview[]> {
  const all: NormalizedReview[] = [];

  try {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const url = new URL(REVIEWS_ENDPOINT);
      url.searchParams.set("api_token", creds.apiToken);
      url.searchParams.set("shop_domain", creds.shopDomain);
      url.searchParams.set("per_page", String(PER_PAGE));
      url.searchParams.set("page", String(page));
      url.searchParams.set("published", "true");

      const res = await fetch(url.toString());
      if (!res.ok) break;
      const json = (await res.json()) as JudgemeReviewsResponse;
      const reviews = json.reviews ?? [];
      if (reviews.length === 0) break;

      for (const r of reviews) {
        if (r.curated !== "ok" && r.curated !== undefined) {
          // ne garder que les avis "curated ok" quand l'info est fournie
          if (r.curated && r.curated !== "ok") continue;
        }
        const date = new Date(r.created_at);
        all.push({
          externalId: String(r.id),
          productExternalId: r.product_external_id !== null ? String(r.product_external_id) : null,
          rating: r.rating,
          title: r.title,
          body: r.body,
          authorName: r.reviewer?.name ?? null,
          verifiedPurchase: r.verified === "verified-purchase" || r.verified === "verified_purchase",
          publishedAt: Number.isNaN(date.getTime()) ? new Date() : date,
        });
      }

      if (reviews.length < PER_PAGE) break;
    }
  } catch {
    return []; // dégradation gracieuse — jamais de donnée inventée pour compenser
  }

  return all;
}
