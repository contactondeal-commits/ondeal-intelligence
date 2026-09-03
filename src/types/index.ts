// Types partagés du domaine OnDeal Intelligence.
// Convention : toute valeur non disponible est `null` (jamais 0, jamais une
// chaîne vide utilisée comme valeur par défaut fictive). Les couches UI sont
// responsables d'afficher "Non disponible / connexion nécessaire" pour `null`.

export type Nullable<T> = T | null;

export type StockStatus =
  | "rupture"
  | "rupture_imminente"
  | "stock_faible"
  | "stock_normal"
  | "surstock"
  | "stock_dormant"
  | "inconnu";

export interface StockAnalysis {
  productId: string;
  variantId: string;
  title: string;
  sku: Nullable<string>;
  storeStock: Nullable<number>;
  supplierStock: Nullable<number>;
  dailyVelocity: Nullable<number>; // unités/jour, null si historique de ventes insuffisant
  daysOfStock: Nullable<number>;
  status: StockStatus;
  supplierMismatch: boolean; // storeStock === 0 && supplierStock > 0
  lastSyncedAt: Nullable<string>;
}

export interface MarginAnalysis {
  productId: string;
  variantId: string;
  title: string;
  sellingPrice: Nullable<number>;
  supplierCost: Nullable<number>;
  shippingCost: Nullable<number>;
  paymentFees: Nullable<number>;
  otherFixedCost: Nullable<number>;
  totalCost: Nullable<number>;
  margin: Nullable<number>;
  marginRate: Nullable<number>; // 0-1
  missingAssumptions: string[]; // ex: ["supplierCost", "shippingCost"]
}

export interface ScoreFactor {
  key: string;
  label: string;
  weight: number; // pondération réellement appliquée (0-1)
  rawValue: Nullable<number>;
  normalizedValue: Nullable<number>; // 0-100, null si donnée indisponible → facteur neutre exclu du calcul
  contribution: number; // points apportés au score final (0 si donnée indisponible)
  available: boolean;
}

export interface ScoreBreakdown {
  score: number; // 0-100
  factors: ScoreFactor[];
  dataCompleteness: number; // % de facteurs disponibles, 0-100
}

export type ProductTier = "a_booster" | "performant" | "a_optimiser" | "a_surveiller" | "a_revoir";

export interface ReviewThemeMention {
  theme: string;
  count: number;
  sentiment: "positif" | "negatif" | "mixte";
}

export interface ReviewAnalysis {
  storeId: string;
  totalReviews: number;
  averageRating: Nullable<number>;
  ratingTrend: Nullable<number>; // delta vs période précédente, null si historique insuffisant
  recentReviews: number; // 30 derniers jours
  positiveCount: number;
  negativeCount: number;
  productsWithoutReviews: number;
  productsWithFewReviews: number; // < 5 avis
  themes: ReviewThemeMention[];
}

export type RecommendationSeverityUI = "URGENT" | "OPPORTUNITY" | "SUGGESTION";

export interface RecommendationView {
  id: string;
  category: string;
  severity: RecommendationSeverityUI;
  title: string;
  reason: string;
  impact: string;
  confidence: number;
  actionLabel: Nullable<string>;
  actionType: Nullable<string>;
  productId: Nullable<string>;
  productTitle: Nullable<string>;
  status: "OPEN" | "DISMISSED" | "ACTIONED";
  createdAt: string;
}

export interface DashboardMetric {
  label: string;
  value: Nullable<string>;
  available: boolean;
  hint?: string;
}

export interface AssistantAnswer {
  question: string;
  matchedIntent: Nullable<string>;
  answer: string;
  dataPoints: Record<string, unknown>;
  generatedBy: "rules" | "llm";
}
