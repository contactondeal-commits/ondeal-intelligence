import type { RecommendationSeverity } from "@prisma/client";

/**
 * Moteur de regroupement des recommandations — "intelligence de groupe".
 *
 * Le moteur de recommandations (recommendations.ts) génère une recommandation
 * PAR VARIANTE en rupture, PAR PRODUIT sans avis, etc. C'est correct pour le
 * traitement (chaque variante doit pouvoir être traitée individuellement),
 * mais c'est illisible affiché tel quel : 1036 lignes "rupture" pour 184
 * produits en rupture réelle.
 *
 * Ce module ne invente, ne déduplique et ne masque AUCUNE donnée — il
 * regroupe des recommandations déjà réelles par (catégorie + produit) pour
 * produire un résumé humainement lisible, avec un lien vers le détail complet.
 * Le total de recommandations réelles reste calculable et affiché.
 */

export type RecommendationSeverityLike = RecommendationSeverity | "URGENT" | "OPPORTUNITY" | "SUGGESTION";

export interface GroupableRecommendation {
  id: string;
  category: string;
  severity: RecommendationSeverityLike;
  title: string;
  reason: string;
  impact: string;
  confidence: number;
  actionLabel: string | null;
  actionType: string | null;
  /** Données réelles nécessaires à la Simulation (prix/coûts ou stock/vélocité) — jamais interprété ici, seulement transmis. */
  actionPayloadJson?: string | null;
  product?: { id: string; title: string } | null;
}

export interface RecommendationGroup {
  /** Clé stable : catégorie + produit (ou catégorie seule si pas de produit) */
  key: string;
  category: string;
  severity: RecommendationSeverityLike;
  /** Le produit concerné, si toutes les recos du groupe portent sur le même produit */
  product: { id: string; title: string } | null;
  /** Toutes les recommandations réelles regroupées ici — rien n'est perdu */
  items: GroupableRecommendation[];
  /** Titre lisible pour le groupe (ex: "3 variantes en rupture de stock") */
  title: string;
  /** Confiance = confiance max des items du groupe (le signal le plus fort l'emporte) */
  confidence: number;
  /** Item représentatif pour reason/impact/action (le plus élevé en confiance) */
  representative: GroupableRecommendation;
}

const SEVERITY_ORDER: Record<string, number> = { URGENT: 0, OPPORTUNITY: 1, SUGGESTION: 2 };

/**
 * Regroupe une liste de recommandations par (produit, catégorie) quand un
 * produit est présent, sinon par catégorie seule. Trie les groupes par
 * sévérité puis par nombre d'items (les problèmes les plus larges d'abord).
 */
export function groupRecommendations(recs: GroupableRecommendation[]): RecommendationGroup[] {
  const groups = new Map<string, GroupableRecommendation[]>();

  for (const rec of recs) {
    const key = rec.product ? `${rec.category}:${rec.product.id}` : `${rec.category}:${rec.id}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(rec);
    else groups.set(key, [rec]);
  }

  const result: RecommendationGroup[] = [];
  for (const [key, items] of groups) {
    const sorted = [...items].sort((a, b) => b.confidence - a.confidence);
    const representative = sorted[0]!;
    const count = items.length;
    const product = representative.product ?? null;

    let title: string;
    if (count === 1) {
      title = representative.title;
    } else if (product) {
      title = `${product.title} — ${count} ${pluralizeIssue(representative.category, count)}`;
    } else {
      title = `${count} ${pluralizeIssue(representative.category, count)}`;
    }

    result.push({
      key,
      category: representative.category,
      severity: representative.severity,
      product,
      items,
      title,
      confidence: Math.max(...items.map((r) => r.confidence)),
      representative,
    });
  }

  return result.sort((a, b) => {
    const sevDiff = (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9);
    if (sevDiff !== 0) return sevDiff;
    if (b.items.length !== a.items.length) return b.items.length - a.items.length;
    return b.confidence - a.confidence;
  });
}

const CATEGORY_PLURAL: Record<string, string> = {
  stock: "variantes concernées par un problème de stock",
  margin: "problèmes de marge",
  reviews: "problèmes liés aux avis",
  marketing: "opportunités marketing",
  data_quality: "problèmes de qualité de données",
};

function pluralizeIssue(category: string, count: number): string {
  const base = CATEGORY_PLURAL[category] ?? "problèmes";
  return count === 1 ? base.replace(/s$/, "") : base;
}

export interface SeverityCounts {
  urgent: number;
  opportunity: number;
  suggestion: number;
  total: number;
}

/** Compte les recommandations réelles (non groupées) par sévérité — pour les chiffres officiels. */
export function countBySeverity(recs: Array<{ severity: RecommendationSeverityLike }>): SeverityCounts {
  const urgent = recs.filter((r) => r.severity === "URGENT").length;
  const opportunity = recs.filter((r) => r.severity === "OPPORTUNITY").length;
  const suggestion = recs.filter((r) => r.severity === "SUGGESTION").length;
  return { urgent, opportunity, suggestion, total: recs.length };
}
