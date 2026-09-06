import { z } from "zod";
import { prisma } from "@/lib/db";
import { resolveCostInputs } from "@/lib/intelligence/costs";
import { analyzeMargin, type MarginInput } from "@/lib/intelligence/margin";
import { AnthropicProvider } from "@/lib/ai/providers/anthropic";
import { estimateCostUsd } from "@/lib/ai/models/cost";
import type { JobStepDefinition } from "@/lib/ai/jobs/types";

/**
 * ONDEAL AI JOB ENGINE — premier type de job réel : "analyze_margin_risk"
 * (PHASE 1 — real frontier vertical slice, 06/09/2026).
 *
 * Ce n'est PAS un nouveau moteur de marge : `resolveCostInputs` et
 * `analyzeMargin` (vertical slice « marge réelle », 03/09/2026) sont
 * réutilisés SANS AUCUNE modification — même règle REAL > CALCULATED >
 * ESTIMATED > jamais inventé. Ce fichier ajoute seulement le PLAN de job
 * (3 steps) qui expose ce moteur existant via le Job Engine :
 *
 *   1. collect_margin_evidence   — TOOL EXECUTION, donnée boutique RÉELLE.
 *      Ne retient QUE les variantes dont la marge BRUTE est réellement
 *      calculable (prix réel + coût réel Shopify OU repli CostAssumption
 *      explicite) — jamais une variante dont le coût est "unavailable".
 *      Aucune hypothèse de transport/frais boutique n'entre ici : ce job ne
 *      dépend que de valeurs REAL ou explicitement résolues.
 *   2. reason_margin_risk        — MODEL REASONING WHEN NEEDED. Skippe
 *      l'appel modèle (coût zéro) si l'évidence est vide. Le modèle reçoit
 *      UNIQUEMENT les lignes d'évidence réelle et doit répondre en JSON
 *      strict, sans jamais inventer un variantId ou une valeur numérique.
 *   3. verify_margin_risk_grounding — VERIFICATION. Rejette (et fait
 *      échouer/retenter le step, jamais un succès silencieux) toute
 *      recommandation qui référence un variantId absent de l'évidence
 *      collectée au step 1, ou un variantId dupliqué. C'est la garantie
 *      "NO PARTIAL THEATER" pour ce job : aucune recommandation non
 *      ancrée dans une donnée réelle ne peut atteindre Job.resultJson.
 */

const COLLECT_STEP_NAME = "collect_margin_evidence";
const REASON_STEP_NAME = "reason_margin_risk";
const VERIFY_STEP_NAME = "verify_margin_risk_grounding";

export const DEFAULT_MARGIN_RISK_LIMIT = 20;
export const MAX_MARGIN_RISK_LIMIT = 50;
const REASON_MODEL = "claude-haiku-4-5-20251001"; // modèle rapide déjà en production (voir src/lib/intelligence/assistant.ts) — pas de nouveau provider/modèle pour cette tâche.

export interface MarginRiskEvidenceRow {
  variantId: string;
  productId: string;
  title: string;
  sellingPrice: number;
  supplierCost: number;
  supplierCostSource: "shopify_unit_cost" | "cost_assumption";
  grossMargin: number;
  grossMarginRate: number;
}

export interface MarginRiskEvidence {
  storeId: string;
  generatedAt: string;
  totalVariantsConsidered: number;
  totalWithComputableGrossMargin: number;
  rows: MarginRiskEvidenceRow[];
}

export interface MarginRiskRecommendation {
  variantId: string;
  priority: number;
  rationale: string;
}

export interface MarginRiskResult {
  storeId: string;
  generatedAt: string;
  evidenceCount: number;
  recommendations: MarginRiskRecommendation[];
}

function clampLimit(rawLimit: unknown): number {
  const n = typeof rawLimit === "number" ? rawLimit : Number.NaN;
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_MARGIN_RISK_LIMIT;
  return Math.min(Math.floor(n), MAX_MARGIN_RISK_LIMIT);
}

/**
 * TOOL EXECUTION réelle : lit Product/Variant/CostAssumption/Store pour UNE
 * boutique réelle (scopée par storeId), calcule la marge brute de chaque
 * variante avec le moteur existant, ne garde que celles réellement
 * calculables, trie par marge brute croissante (risque le plus élevé
 * d'abord) et tronque à `limit`.
 */
export async function collectMarginEvidence(storeId: string, rawLimit: unknown): Promise<MarginRiskEvidence> {
  const limit = clampLimit(rawLimit);
  const storeDefaults = await prisma.store.findUnique({
    where: { id: storeId },
    select: { defaultShippingCost: true, defaultPaymentFeesRate: true },
  });
  const products = await prisma.product.findMany({
    where: { storeId },
    include: { variants: true, costAssumption: true },
  });

  let totalVariantsConsidered = 0;
  const computable: MarginRiskEvidenceRow[] = [];

  for (const p of products) {
    for (const v of p.variants) {
      totalVariantsConsidered += 1;
      const costs = resolveCostInputs(v, p.costAssumption, storeDefaults);
      const input: MarginInput = {
        productId: p.id,
        variantId: v.id,
        title: p.variants.length > 1 ? `${p.title} — ${v.title}` : p.title,
        sellingPrice: v.price,
        supplierCost: costs.supplierCost,
        supplierCostSource: costs.supplierCostSource,
        shippingCost: costs.shippingCost,
        paymentFeesRate: costs.paymentFeesRate,
        otherFixedCost: costs.otherFixedCost,
      };
      const analysis = analyzeMargin(input);
      if (analysis.grossMargin === null || analysis.grossMarginRate === null) continue; // coût ou prix indisponible — jamais inventé
      computable.push({
        variantId: analysis.variantId,
        productId: analysis.productId,
        title: analysis.title,
        sellingPrice: analysis.sellingPrice as number,
        supplierCost: analysis.supplierCost as number,
        supplierCostSource: analysis.supplierCostSource as "shopify_unit_cost" | "cost_assumption",
        grossMargin: analysis.grossMargin,
        grossMarginRate: analysis.grossMarginRate,
      });
    }
  }

  computable.sort((a, b) => a.grossMarginRate - b.grossMarginRate);

  return {
    storeId,
    generatedAt: new Date().toISOString(),
    totalVariantsConsidered,
    totalWithComputableGrossMargin: computable.length,
    rows: computable.slice(0, limit),
  };
}

const collectEvidenceStep: JobStepDefinition = {
  name: COLLECT_STEP_NAME,
  async run(ctx) {
    const input = ctx.input as { limit?: number } | null;
    const evidence = await collectMarginEvidence(ctx.storeId, input?.limit);
    return { output: evidence };
  },
};

function extractJsonText(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced?.[1] ?? trimmed).trim();
}

const recommendationSchema = z.object({
  variantId: z.string().min(1),
  priority: z.number().int().min(1),
  rationale: z.string().min(1).max(500),
});
const recommendationsSchema = z.object({
  recommendations: z.array(recommendationSchema).max(MAX_MARGIN_RISK_LIMIT),
});

function buildReasonPrompt(evidence: MarginRiskEvidence): { system: string; userMessage: string } {
  const system = [
    "Tu es un analyste e-commerce qui revoit des variantes à marge brute réellement calculée sur une boutique Shopify réelle.",
    "RÈGLES STRICTES, sans exception :",
    "1. Chaque recommandation DOIT référencer un \"variantId\" copié EXACTEMENT depuis la liste fournie — n'invente jamais un identifiant, n'en modifie aucun caractère.",
    "2. N'invente et ne recalcule jamais un prix, un coût ou un taux de marge : ta justification doit rester factuelle et cohérente avec les valeurs fournies, sans avancer de nouveaux chiffres non présents dans la liste.",
    "3. N'inclus jamais une variante absente de la liste fournie, et jamais deux fois la même variante.",
    "4. Réponds STRICTEMENT avec un objet JSON valide, sans aucun texte avant ou après, au format exact :",
    '{"recommendations":[{"variantId":"...","priority":1,"rationale":"..."}]}',
    "\"priority\" : entier, 1 = le plus urgent à revoir. \"rationale\" : une phrase en français, factuelle.",
  ].join("\n");
  const userMessage = `Variantes à marge brute la plus faible (données réelles, JSON) :\n${JSON.stringify(evidence.rows)}\n\nProduis la liste priorisée, au format JSON exact demandé, pour au plus ${evidence.rows.length} entrée(s).`;
  return { system, userMessage };
}

const reasonStep: JobStepDefinition = {
  name: REASON_STEP_NAME,
  async run(ctx) {
    const evidence = ctx.priorOutputs[0] as MarginRiskEvidence;
    // MODEL REASONING WHEN NEEDED : rien à raisonner, rien à dépenser.
    if (!evidence || evidence.rows.length === 0) {
      return { output: { recommendations: [] } };
    }

    const provider = new AnthropicProvider();
    const { system, userMessage } = buildReasonPrompt(evidence);
    const generated = await provider.generate({
      model: REASON_MODEL,
      system,
      userMessage,
      maxTokens: 1500,
    });

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(extractJsonText(generated.text));
    } catch {
      throw new Error("Réponse du modèle non conforme au format JSON attendu — impossible de la parser.");
    }
    const validated = recommendationsSchema.safeParse(parsedJson);
    if (!validated.success) {
      throw new Error(`Format de recommandations invalide renvoyé par le modèle : ${validated.error.message}`);
    }

    // Coût observable (PHASE 2, § « coût observable ») : calculé UNIQUEMENT
    // à partir des tokens réellement rapportés par le provider et du tarif
    // vérifié dans ANTHROPIC_CAPABILITIES — jamais estimé, jamais forcé à 0.
    const costUsd = estimateCostUsd(provider, REASON_MODEL, generated.tokensIn, generated.tokensOut);

    return {
      output: validated.data,
      provider: provider.name,
      model: REASON_MODEL,
      tokensIn: generated.tokensIn ?? undefined,
      tokensOut: generated.tokensOut ?? undefined,
      costUsd: costUsd ?? undefined,
    };
  },
};

const verifyStep: JobStepDefinition = {
  name: VERIFY_STEP_NAME,
  async run(ctx) {
    const evidence = ctx.priorOutputs[0] as MarginRiskEvidence;
    const reasoning = ctx.priorOutputs[1] as { recommendations: MarginRiskRecommendation[] };

    const knownVariantIds = new Set(evidence.rows.map((r) => r.variantId));
    const seen = new Set<string>();
    for (const rec of reasoning.recommendations) {
      if (!knownVariantIds.has(rec.variantId)) {
        throw new Error(`Vérification de l'ancrage échouée : variantId "${rec.variantId}" absent de l'évidence réelle collectée.`);
      }
      if (seen.has(rec.variantId)) {
        throw new Error(`Vérification de l'ancrage échouée : variantId "${rec.variantId}" recommandé plus d'une fois.`);
      }
      seen.add(rec.variantId);
    }

    const result: MarginRiskResult = {
      storeId: evidence.storeId,
      generatedAt: evidence.generatedAt,
      evidenceCount: evidence.rows.length,
      recommendations: reasoning.recommendations,
    };
    return { output: result };
  },
};

export const marginRiskSteps: JobStepDefinition[] = [collectEvidenceStep, reasonStep, verifyStep];

// Exports individuels — utilisés par les tests (accès direct, sans indexation
// de tableau sous noUncheckedIndexedAccess) et par tout futur appelant qui
// voudrait composer un plan différent réutilisant un step précis.
export { collectEvidenceStep, reasonStep, verifyStep };
