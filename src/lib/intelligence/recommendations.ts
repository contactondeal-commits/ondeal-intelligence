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
        actionPayload: { variantId: s.variantId },
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
        actionPayload: { variantId: s.variantId },
      });
    }
  }

  // 🔴 URGENT — marge négative / 🟠 marge faible
  for (const m of ctx.margin) {
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
        actionPayload: { productId: m.productId, variantId: m.variantId, currentPrice: m.sellingPrice },
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
        actionPayload: { productId: m.productId, variantId: m.variantId, currentPrice: m.sellingPrice },
      });
    } else if (m.marginRate !== null && m.marginRate >= MARGIN_THRESHOLDS.fortRate) {
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

export function severityWeight(s: GeneratedSeverity): number {
  return s === "URGENT" ? 0 : s === "OPPORTUNITY" ? 1 : 2;
}
