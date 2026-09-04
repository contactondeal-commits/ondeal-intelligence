import type { MarginAnalysis, StockAnalysis } from "@/types";
import { MARGIN_THRESHOLDS } from "@/lib/intelligence/margin";

export type GeneratedSeverity = "URGENT" | "OPPORTUNITY" | "SUGGESTION";

export interface GeneratedRecommendation {
  productId: string | null;
  category:
    | "stock"
    | "margin"
    | "reviews"
    | "marketing"
    | "data_quality"
    | "content";
  severity: GeneratedSeverity;
  title: string;
  reason: string;
  impact: string;
  confidence: number; // 0-100
  actionLabel: string | null;
  actionType: string | null;
  actionPayload?: Record<string, unknown>;
}

export interface RecommendationContext {
  stock: StockAnalysis[];
  margin: MarginAnalysis[];
  score: Array<{ productId: string; title: string; score: number; dataCompleteness: number }>;
  reviewsWithoutAny: Array<{ productId: string; title: string }>;
  activeWithoutStock: Array<{ productId: string; title: string }>;
  dataIssues: Array<{ productId: string | null; title: string; issue: string }>;
}

/**
 * PHASE 4 — Centre d'intelligence. Génère des recommandations 100%
 * déterministes à partir des analyses déjà calculées (stock/marge/score) —
 * aucune donnée n'est inventée ici, seules des règles explicites sur des
 * données réelles ou explicitement absentes.
 */
export function generateRecommendations(ctx: RecommendationContext): GeneratedRecommendation[] {
  const recs: GeneratedRecommendation[] = [];

  // 🔴 URGENT — rupture / rupture imminente
  for (const s of ctx.stock) {
    if (s.status === "rupture") {
      recs.push({
        productId: s.productId,
        category: "stock",
        severity: "URGENT",
        title: `Rupture de stock — ${s.title}`,
        reason: `Le stock boutique de "${s.title}" est à 0.${
          s.supplierMismatch ? " Le fournisseur dispose pourtant d'un stock disponible." : ""
        }`,
        impact: "Ventes perdues tant que le produit reste indisponible à l'achat.",
        confidence: 95,
        actionLabel: s.supplierMismatch ? "Vérifier le réassort fournisseur" : "Vérifier le fournisseur",
        actionType: "review_supplier",
        actionPayload: { variantId: s.variantId, storeStock: s.storeStock, dailyVelocity: s.dailyVelocity },
      });
    } else if (s.status === "rupture_imminente") {
      recs.push({
        productId: s.productId,
        category: "stock",
        severity: "URGENT",
        title: `Rupture imminente — ${s.title}`,
        reason: `Il reste environ ${Math.round(s.daysOfStock ?? 0)} jour(s) de stock au rythme de vente actuel.`,
        impact: "Risque de rupture sous 7 jours si aucun réassort n'est engagé.",
        confidence: 85,
        actionLabel: "Vérifier le fournisseur",
        actionType: "review_supplier",
        // storeStock/dailyVelocity réels transmis pour permettre la simulation
        // "et si je reçois N unités ?" (Command Center → Simulation) sans
        // recalcul dupliqué — mêmes valeurs que celles déjà utilisées par
        // analyzeStock pour ce statut.
        actionPayload: { variantId: s.variantId, storeStock: s.storeStock, dailyVelocity: s.dailyVelocity },
      });
    }
  }

  // 🔴 URGENT — marge négative / 🟠 marge faible
  for (const m of ctx.margin) {
    // Le taux de frais de paiement n'est pas conservé tel quel dans
    // MarginAnalysis (seul le montant € au prix actuel l'est) — il se
    // retrouve par simple algèbre à partir de valeurs déjà réelles
    // (paymentFees = sellingPrice × rate), jamais réinventé.
    const paymentFeesRate =
      m.sellingPrice && m.sellingPrice > 0 && m.paymentFees !== null ? m.paymentFees / m.sellingPrice : null;
    const simulationPayload = {
      productId: m.productId,
      variantId: m.variantId,
      currentPrice: m.sellingPrice,
      supplierCost: m.supplierCost,
      supplierCostSource: m.supplierCostSource,
      shippingCost: m.shippingCost,
      paymentFeesRate,
      otherFixedCost: m.otherFixedCost,
    };
    const costLabel = m.supplierCostSource === "shopify_unit_cost" ? "coût réel Shopify" : "hypothèse de coût OnDeal";

    // MARGE BRUTE (prix − coût fournisseur, avant transport/frais) : signal
    // réel dès que le coût Shopify est connu, même sans hypothèses
    // boutique. Jamais présenté comme une marge nette. Ne se déclenche que
    // si la marge complète n'est pas calculable (sinon c'est elle qui parle).
    if (m.margin === null && m.grossMargin !== null && m.grossMargin < 0) {
      recs.push({
        productId: m.productId,
        category: "margin",
        severity: "URGENT",
        title: `Marge brute négative — ${m.title}`,
        reason: `Le ${costLabel} (${m.supplierCost?.toFixed(2)} €) dépasse le prix de vente (${m.sellingPrice?.toFixed(2)} €), avant même transport et frais de paiement.`,
        impact: "Chaque vente de cette variante génère une perte, quelles que soient les hypothèses de frais.",
        confidence: 90,
        actionLabel: "Modifier le prix",
        actionType: "update_price",
        actionPayload: simulationPayload,
      });
      continue;
    }
    if (m.margin === null && m.grossMarginRate !== null && m.grossMarginRate >= 0 && m.grossMarginRate < MARGIN_THRESHOLDS.faibleRate) {
      recs.push({
        productId: m.productId,
        category: "margin",
        severity: "SUGGESTION",
        title: `Marge brute faible — ${m.title}`,
        reason: `Marge brute de ${(m.grossMarginRate * 100).toFixed(1)}% (prix ${m.sellingPrice?.toFixed(2)} € − ${costLabel} ${m.supplierCost?.toFixed(2)} €), sous le seuil de ${MARGIN_THRESHOLDS.faibleRate * 100}% avant transport et frais de paiement.`,
        impact: "Une fois le transport et les frais de paiement déduits, cette variante risque de ne plus rien dégager.",
        confidence: 70,
        actionLabel: "Revoir le prix",
        actionType: "update_price",
        actionPayload: simulationPayload,
      });
      continue;
    }

    if (m.margin !== null && m.margin < 0) {
      recs.push({
        productId: m.productId,
        category: "margin",
        severity: "URGENT",
        title: `Marge négative — ${m.title}`,
        reason: `Le coût total (${m.totalCost?.toFixed(2)} €) dépasse le prix de vente (${m.sellingPrice?.toFixed(2)} €).`,
        impact: "Chaque vente de ce produit génère une perte nette.",
        confidence: 90,
        actionLabel: "Modifier le prix",
        actionType: "update_price",
        actionPayload: simulationPayload,
      });
    } else if (
      m.marginRate !== null &&
      m.marginRate >= 0 &&
      m.marginRate < MARGIN_THRESHOLDS.faibleRate
    ) {
      recs.push({
        productId: m.productId,
        category: "margin",
        severity: "SUGGESTION",
        title: `Marge faible — ${m.title}`,
        reason: `Taux de marge estimé à ${(m.marginRate * 100).toFixed(1)}%, sous le seuil de ${MARGIN_THRESHOLDS.faibleRate * 100}%.`,
        impact: "Marge dégagée limitée sur ce produit à volume de vente égal.",
        confidence: 70,
        actionLabel: "Revoir le prix ou le coût fournisseur",
        actionType: "update_price",
        actionPayload: simulationPayload,
      });
    } else if (m.marginRate !== null && m.marginRate >= MARGIN_THRESHOLDS.fortRate && sellsRecently(ctx, m.productId)) {
      // Une "forte marge" n'est une OPPORTUNITÉ de mise en avant que si le
      // produit se vend déjà : sur un catalogue dropshipping où 90 % des
      // variantes dépassent 40 % de marge brute, recommander de promouvoir
      // 10 000 produits sans aucune vente n'est pas un signal — c'est du
      // bruit (constaté sur la boutique réelle le 03/09/2026).
      recs.push({
        productId: m.productId,
        category: "margin",
        severity: "OPPORTUNITY",
        title: `Forte marge — ${m.title}`,
        reason: `Taux de marge estimé à ${(m.marginRate * 100).toFixed(1)}%.`,
        impact: "Bon candidat pour une mise en avant marketing : chaque vente supplémentaire est très rentable.",
        confidence: 75,
        actionLabel: "Promouvoir ce produit",
        actionType: "promote_product",
        actionPayload: { productId: m.productId },
      });
    }
  }

  // 🔴 données incohérentes
  for (const s of ctx.stock) {
    if (s.supplierMismatch) {
      recs.push({
        productId: s.productId,
        category: "data_quality",
        severity: "URGENT",
        title: `Stock boutique à 0 mais fournisseur disponible — ${s.title}`,
        reason: `Stock fournisseur connu : ${s.supplierStock}. Stock boutique : 0.`,
        impact: "Ventes perdues alors que le produit est réapprovisionnable immédiatement.",
        confidence: 90,
        actionLabel: "Synchroniser le stock",
        actionType: "review_supplier",
        actionPayload: { variantId: s.variantId },
      });
    }
  }
  for (const issue of ctx.dataIssues) {
    recs.push({
      productId: issue.productId,
      category: "data_quality",
      severity: "SUGGESTION",
      title: `Donnée incohérente — ${issue.title}`,
      reason: issue.issue,
      impact: "Peut fausser le scoring et les recommandations tant que non corrigée.",
      confidence: 60,
      actionLabel: null,
      actionType: null,
    });
  }

  // Produit actif sans stock du tout (statut Shopify actif mais 0 partout)
  for (const p of ctx.activeWithoutStock) {
    recs.push({
      productId: p.productId,
      category: "stock",
      severity: "URGENT",
      title: `Produit actif publié sans stock — ${p.title}`,
      reason: "Ce produit est publié (visible sur la boutique) mais son stock est à 0 partout.",
      impact: "Le client peut voir le produit mais ne peut pas l'acheter — mauvaise expérience et ventes perdues.",
      confidence: 88,
      actionLabel: "Dépublier ou réapprovisionner",
      actionType: "unpublish_product",
      actionPayload: { productId: p.productId },
    });
  }

  // 🟢 avis
  for (const p of ctx.reviewsWithoutAny) {
    recs.push({
      productId: p.productId,
      category: "reviews",
      severity: "SUGGESTION",
      title: `Aucun avis — ${p.title}`,
      reason: "Ce produit n'a reçu aucun avis client à ce jour.",
      impact: "L'absence d'avis réduit la confiance des visiteurs et la conversion.",
      confidence: 65,
      actionLabel: "Demander des avis",
      actionType: "request_reviews",
      actionPayload: { productId: p.productId },
    });
  }

  // 🟠 produit populaire mal optimisé (score correct mais data incomplète)
  for (const sc of ctx.score) {
    if (sc.score >= 60 && sc.dataCompleteness < 60) {
      recs.push({
        productId: sc.productId,
        category: "content",
        severity: "SUGGESTION",
        title: `Fiche à compléter — ${sc.title}`,
        reason: `Le score OnDeal (${sc.score}/100) est calculé avec seulement ${sc.dataCompleteness}% des facteurs disponibles.`,
        impact: "Compléter les données manquantes (coûts, contenu) permettrait un score plus fiable et de meilleures recommandations.",
        confidence: 55,
        actionLabel: "Compléter la fiche produit",
        actionType: "edit_product_data",
        actionPayload: { productId: sc.productId },
      });
    }
  }

  return recs;
}

/**
 * Le produit a-t-il vendu sur la fenêtre de vélocité ? Si aucune analyse de
 * stock n'existe pour lui (contexte partiel), on ne peut pas l'exclure —
 * comportement historique conservé ; si des analyses existent, il faut au
 * moins une variante avec une vélocité strictement positive.
 */
function sellsRecently(ctx: RecommendationContext, productId: string): boolean {
  const stockForProduct = ctx.stock.filter((s) => s.productId === productId);
  if (stockForProduct.length === 0) return true;
  return stockForProduct.some((s) => (s.dailyVelocity ?? 0) > 0);
}

export function severityWeight(s: GeneratedSeverity): number {
  return s === "URGENT" ? 0 : s === "OPPORTUNITY" ? 1 : 2;
}
