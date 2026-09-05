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
  /** € estimé/semaine (ex. vélocité × prix × 7j). null si non calculable — jamais 0 par défaut. */
  impactScore?: number | null;
  actionLabel: string | null;
  actionType: string | null;
  actionPayload?: Record<string, unknown>;
}

/**
 * Impact € estimé sur 7 jours = vélocité de vente connue × prix de vente
 * connu × 7. Retourne null (jamais 0) dès qu'une des deux données manque —
 * un impact "estimé à 0€" serait indiscernable d'un vrai zéro et fausserait
 * tout tri par impact décroissant.
 */
function estimateWeeklyImpact(dailyVelocity: number | null, price: number | null): number | null {
  if (dailyVelocity === null || price === null) return null;
  return dailyVelocity * price * 7;
}

function averageKnownPrice(prices: number[]): number | null {
  return prices.length > 0 ? prices.reduce((sum, p) => sum + p, 0) / prices.length : null;
}

interface StockProductGroup {
  productId: string;
  variantIds: string[];
  totalStoreStock: number;
  // La vélocité de vente est calculée au niveau PRODUIT (SalesSnapshot n'est
  // PAS ventilé par variante — voir schema.prisma), donc identique pour
  // toutes les variantes d'un même produit : capturée UNE FOIS, jamais
  // sommée sur les variantes (une somme multiplierait artificiellement
  // l'impact par le nombre de variantes du groupe).
  velocity: number | null;
  supplierMismatch: boolean;
  knownPrices: number[];
  minDaysOfStock: number | null;
}

function groupStockByProduct(analyses: StockAnalysis[], priceByVariant: Map<string, number | null>): Map<string, StockProductGroup> {
  const groups = new Map<string, StockProductGroup>();
  for (const s of analyses) {
    let g = groups.get(s.productId);
    if (!g) {
      g = { productId: s.productId, variantIds: [], totalStoreStock: 0, velocity: null, supplierMismatch: false, knownPrices: [], minDaysOfStock: null };
      groups.set(s.productId, g);
    }
    g.variantIds.push(s.variantId);
    g.totalStoreStock += s.storeStock ?? 0;
    if (g.velocity === null) g.velocity = s.dailyVelocity;
    if (s.supplierMismatch) g.supplierMismatch = true;
    const price = priceByVariant.get(s.variantId) ?? null;
    if (price !== null) g.knownPrices.push(price);
    if (s.daysOfStock !== null) g.minDaysOfStock = g.minDaysOfStock === null ? s.daysOfStock : Math.min(g.minDaysOfStock, s.daysOfStock);
  }
  return groups;
}

/**
 * Regroupe les variantes en rupture (et, séparément, en rupture imminente)
 * PAR PRODUIT avant de générer un signal — un même produit à N variantes
 * en rupture ne doit produire qu'UNE recommandation "Vérifier le
 * fournisseur", pas N recommandations identiques (voir group.ts, qui ne
 * faisait que ce regroupement à l'AFFICHAGE ; ici c'est fait à la source,
 * ce qui rend chaque Recommendation directement actionnable et le taux
 * d'action mesurable un-à-un avec les décisions réellement prises).
 *
 * Un produit à une seule variante en rupture garde le format mono-variante
 * historique (payload `variantId` singulier) — c'est le cas majoritaire, et
 * il n'y a aucune ambiguïté à résoudre : la simulation "et si je reçois N
 * unités ?" reste disponible exactement comme avant. Seuls les groupes de
 * plusieurs variantes (l'ambiguïté "laquelle recevrait le réassort ?" est
 * réelle) basculent sur le format agrégé (payload `variantIds` pluriel,
 * pas de simulation de quantité — voir DecisionCard.tsx).
 */
function generateStockRecommendations(
  stock: StockAnalysis[],
  priceByVariant: Map<string, number | null>,
  productTitleById: Map<string, string>,
): GeneratedRecommendation[] {
  const recs: GeneratedRecommendation[] = [];

  const ruptureGroups = groupStockByProduct(stock.filter((s) => s.status === "rupture"), priceByVariant);
  for (const g of ruptureGroups.values()) {
    const n = g.variantIds.length;
    const productTitle = productTitleById.get(g.productId) ?? "Produit";
    // Une rupture dont la vélocité CONNUE est nulle (0 vente réelle sur 30
    // jours, jamais confondue avec "vélocité inconnue" — null ≠ 0, voir
    // stock.ts) n'est pas urgente : rien ne se perd tant que personne
    // n'achète ce produit. Le signal reste réel, seulement reclassé.
    const isDormant = g.velocity === 0;
    const price = averageKnownPrice(g.knownPrices);
    const impactScore = estimateWeeklyImpact(g.velocity, price);

    if (n === 1) {
      const s = stock.find((x) => x.status === "rupture" && x.productId === g.productId)!;
      recs.push({
        productId: s.productId,
        category: "stock",
        severity: isDormant ? "SUGGESTION" : "URGENT",
        title: isDormant ? `Produit inactif en rupture — ${s.title}` : `Rupture de stock — ${s.title}`,
        reason: isDormant
          ? `Le stock boutique de "${s.title}" est à 0, mais aucune vente n'a été enregistrée sur les 30 derniers jours — la rupture n'a probablement aucun impact commercial actuel.`
          : `Le stock boutique de "${s.title}" est à 0.${s.supplierMismatch ? " Le fournisseur dispose pourtant d'un stock disponible." : ""}`,
        impact: isDormant
          ? "Aucune perte de vente détectée sur cette variante — à réévaluer si la demande reprend."
          : "Ventes perdues tant que le produit reste indisponible à l'achat.",
        confidence: isDormant ? 60 : 95,
        impactScore,
        actionLabel: s.supplierMismatch ? "Vérifier le réassort fournisseur" : "Vérifier le fournisseur",
        actionType: "review_supplier",
        actionPayload: { variantId: s.variantId, storeStock: s.storeStock, dailyVelocity: s.dailyVelocity },
      });
    } else {
      recs.push({
        productId: g.productId,
        category: "stock",
        severity: isDormant ? "SUGGESTION" : "URGENT",
        title: isDormant ? `Produit inactif en rupture — ${productTitle} (${n} variantes)` : `Rupture de stock — ${productTitle} (${n} variantes)`,
        reason: isDormant
          ? `${n} variantes du produit "${productTitle}" sont en rupture de stock, mais aucune vente n'a été enregistrée sur les 30 derniers jours pour ce produit — la rupture n'a probablement aucun impact commercial actuel.`
          : `${n} variantes du produit "${productTitle}" sont en rupture de stock (stock à 0).${
              g.supplierMismatch ? " Le fournisseur dispose pourtant d'un stock disponible pour au moins une variante." : ""
            }`,
        impact: isDormant
          ? "Aucune perte de vente détectée pour ce produit — à réévaluer si la demande reprend."
          : "Ventes perdues tant que ces variantes restent indisponibles à l'achat.",
        confidence: isDormant ? 60 : 95,
        impactScore,
        actionLabel: g.supplierMismatch ? "Vérifier le réassort fournisseur" : "Vérifier le fournisseur",
        actionType: "review_supplier",
        actionPayload: { productId: g.productId, variantIds: g.variantIds, variantCount: n, storeStock: g.totalStoreStock, dailyVelocity: g.velocity },
      });
    }
  }

  const imminenteGroups = groupStockByProduct(stock.filter((s) => s.status === "rupture_imminente"), priceByVariant);
  for (const g of imminenteGroups.values()) {
    const n = g.variantIds.length;
    const productTitle = productTitleById.get(g.productId) ?? "Produit";
    const price = averageKnownPrice(g.knownPrices);
    const impactScore = estimateWeeklyImpact(g.velocity, price);

    if (n === 1) {
      const s = stock.find((x) => x.status === "rupture_imminente" && x.productId === g.productId)!;
      recs.push({
        productId: s.productId,
        category: "stock",
        severity: "URGENT",
        title: `Rupture imminente — ${s.title}`,
        reason: `Il reste environ ${Math.round(s.daysOfStock ?? 0)} jour(s) de stock au rythme de vente actuel.`,
        impact: "Risque de rupture sous 7 jours si aucun réassort n'est engagé.",
        confidence: 85,
        impactScore,
        actionLabel: "Vérifier le fournisseur",
        actionType: "review_supplier",
        // storeStock/dailyVelocity réels transmis pour permettre la simulation
        // "et si je reçois N unités ?" (Command Center → Simulation) sans
        // recalcul dupliqué — mêmes valeurs que celles déjà utilisées par
        // analyzeStock pour ce statut.
        actionPayload: { variantId: s.variantId, storeStock: s.storeStock, dailyVelocity: s.dailyVelocity },
      });
    } else {
      recs.push({
        productId: g.productId,
        category: "stock",
        severity: "URGENT",
        title: `Rupture imminente — ${productTitle} (${n} variantes)`,
        // Le minimum, jamais une moyenne : la variante la plus proche de la
        // rupture est celle qui doit déclencher l'urgence, pas noyée dans
        // une moyenne du groupe.
        reason: `Il reste environ ${Math.round(g.minDaysOfStock ?? 0)} jour(s) de stock pour la variante la plus critique du groupe, au rythme de vente actuel.`,
        impact: "Risque de rupture sous 7 jours si aucun réassort n'est engagé pour ces variantes.",
        confidence: 85,
        impactScore,
        actionLabel: "Vérifier le fournisseur",
        actionType: "review_supplier",
        actionPayload: { productId: g.productId, variantIds: g.variantIds, variantCount: n, storeStock: g.totalStoreStock, dailyVelocity: g.velocity },
      });
    }
  }

  return recs;
}

export interface RecommendationContext {
  stock: StockAnalysis[];
  margin: MarginAnalysis[];
  score: Array<{ productId: string; title: string; score: number; dataCompleteness: number }>;
  reviewsWithoutAny: Array<{ productId: string; title: string }>;
  activeWithoutStock: Array<{ productId: string; title: string }>;
  dataIssues: Array<{ productId: string | null; title: string; issue: string }>;
  // Trafic/acquisition (Google Analytics, 05/09/2026) — déjà calculés par
  // detectTrafficSignals (voir lib/intelligence/traffic.ts) : simplement
  // fusionnés ici, jamais recalculés. Vide (pas absent) si aucune donnée
  // GA4 n'existe pour cette boutique — voir pipeline.ts.
  traffic: GeneratedRecommendation[];
}

/**
 * PHASE 4 — Centre d'intelligence. Génère des recommandations 100%
 * déterministes à partir des analyses déjà calculées (stock/marge/score) —
 * aucune donnée n'est inventée ici, seules des règles explicites sur des
 * données réelles ou explicitement absentes.
 */
export function generateRecommendations(ctx: RecommendationContext): GeneratedRecommendation[] {
  const recs: GeneratedRecommendation[] = [];

  // Prix de vente réel par variante — déjà calculé par l'analyse de marge,
  // jamais recalculé ni deviné ici. Sert uniquement à estimer un impact €
  // pour les signaux de stock (voir estimateWeeklyImpact).
  const priceByVariant = new Map(ctx.margin.map((m) => [m.variantId, m.sellingPrice]));
  // Titre du PRODUIT (pas de la variante) — dérivé de ctx.score, une ligne
  // par produit déjà réelle (voir pipeline.ts), jamais reconstruit en
  // retirant un suffixe de titre de variante.
  const productTitleById = new Map(ctx.score.map((s) => [s.productId, s.title]));

  recs.push(...generateStockRecommendations(ctx.stock, priceByVariant, productTitleById));

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

  // 🟣 Signaux trafic/acquisition (Google Analytics) — déjà entièrement
  // calculés, simplement fusionnés (voir commentaire du champ ctx.traffic).
  recs.push(...ctx.traffic);

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
