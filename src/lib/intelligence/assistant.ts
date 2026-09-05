import type { AssistantAnswer, RecommendationView, StockAnalysis } from "@/types";

// PHASE 12 — Assistant IA. Moteur de requêtes déterministe par défaut :
// chaque intention est mappée à une extraction précise des données déjà
// calculées (jamais une nouvelle invention). Si ANTHROPIC_API_KEY est
// configurée, une couche de formulation en langage naturel est appliquée
// PAR-DESSUS ce même contexte de données (jamais un accès direct au store) —
// voir formatWithLLM ci-dessous.

// LOT 10 (05/09/2026) — Copilot contextuel. Quand la question est posée
// depuis (ou à propos d') une fiche produit précise, le contexte de CE
// produit est injecté ici — jamais recalculé avec une seconde formule :
// mêmes données déjà persistées (ScoreSnapshot) et mêmes modules purs que
// la fiche Product Intelligence (lot 9 : `productSales.ts`) et `/pricing`
// (`margin.ts`/`costs.ts`), résolus une seule fois côté route API.
export interface PageProductContext {
  id: string;
  title: string;
  score: number | null;
  dataCompleteness: number | null;
  marginGatedByPlan: boolean; // true si le plan de la boutique n'inclut pas "pricing" — jamais affiché en clair dans ce cas
  costedVariants: number;
  totalVariants: number;
  avgMarginRatePct: number | null; // null si aucune variante costée, ou si gating de plan
  stockTotal: number | null;
  salesWindowDays: number;
  salesUnitsSold: number;
  salesRevenue: number;
  salesTrendLabel: string | null; // null si historique insuffisant — jamais un delta inventé
}

export interface AssistantContext {
  recommendations: RecommendationView[];
  stock: StockAnalysis[];
  productsWithoutReviews: Array<{ productId: string; title: string }>;
  salesTrendAvailable: boolean;
  storeName: string;
  pageProduct: PageProductContext | null;
}

interface Intent {
  key: string;
  patterns: RegExp[];
  build: (ctx: AssistantContext) => { answer: string; dataPoints: Record<string, unknown> };
}

const INTENTS: Intent[] = [
  {
    // Placé EN PREMIER : une question qui référence explicitement "ce
    // produit"/"cette fiche" doit gagner face à des intentions génériques
    // plus larges (ex. "quelle est la marge de ce produit ?" contiendrait
    // aussi "produit" + "marge", qui matcherait sinon `margin_bad` avant
    // d'atteindre celle-ci — l'ordre du tableau fait foi, `matchIntent`
    // retourne la première correspondance).
    key: "current_product_summary",
    patterns: [/\bce produit\b/i, /\bcette fiche\b/i, /\bce produit[- ]ci\b/i, /\bcette page\b/i],
    build: (ctx) => {
      const p = ctx.pageProduct;
      if (!p) {
        return {
          answer:
            "Vous n'êtes pas actuellement sur une fiche produit précise, je ne peux donc pas savoir à quel produit « ce produit » fait référence. Ouvrez la fiche du produit concerné (Product Intelligence) puis reposez la question, ou indiquez son nom directement.",
          dataPoints: { available: false },
        };
      }
      const lines = [`Fiche consultée : ${p.title}`];
      lines.push(
        p.score !== null
          ? `Score OnDeal : ${p.score}/100 (${p.dataCompleteness}% de données disponibles)`
          : "Score OnDeal : pas encore calculé pour ce produit.",
      );
      if (p.marginGatedByPlan) {
        lines.push("Marge : disponible avec le plan Pro et supérieur.");
      } else if (p.avgMarginRatePct !== null) {
        lines.push(`Marge brute moyenne : ${p.avgMarginRatePct.toFixed(1)} % (${p.costedVariants}/${p.totalVariants} variante(s) avec coût réel connu).`);
      } else {
        lines.push(`Marge : non calculable — aucune des ${p.totalVariants} variante(s) n'a de coût fournisseur renseigné.`);
      }
      lines.push(p.stockTotal !== null ? `Stock total : ${p.stockTotal}` : "Stock total : inconnu.");
      lines.push(
        p.salesTrendLabel
          ? `Ventes sur ${p.salesWindowDays} j : ${p.salesUnitsSold} unité(s), ${p.salesRevenue.toFixed(2)} € (${p.salesTrendLabel} vs la période précédente).`
          : `Ventes sur ${p.salesWindowDays} j : ${p.salesUnitsSold} unité(s), ${p.salesRevenue.toFixed(2)} € — historique insuffisant sur la période précédente pour afficher une évolution fiable.`,
      );
      return { answer: lines.join("\n"), dataPoints: { productId: p.id } };
    },
  },
  {
    key: "today_priorities",
    patterns: [/faire aujourd'?hui/i, /10 priorit/i, /par où commencer/i],
    build: (ctx) => {
      const top = [...ctx.recommendations]
        .sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || b.confidence - a.confidence)
        .slice(0, 10);
      if (top.length === 0) {
        return {
          answer: "Aucune recommandation active actuellement — soit tout est sous contrôle, soit les données nécessaires ne sont pas encore synchronisées.",
          dataPoints: { count: 0 },
        };
      }
      const lines = top.map((r, i) => `${i + 1}. [${severityLabel(r.severity)}] ${r.title} — ${r.reason}`);
      return {
        answer: `Voici vos ${top.length} priorités actuelles :\n${lines.join("\n")}`,
        dataPoints: { recommendations: top.map((r) => r.id) },
      };
    },
  },
  {
    key: "stock_risk",
    patterns: [/risque(nt)? (une |de )?rupture/i, /rupture de stock/i, /à rest?ock/i],
    build: (ctx) => {
      const atRisk = ctx.stock.filter((s) => s.status === "rupture" || s.status === "rupture_imminente");
      if (atRisk.length === 0) {
        return { answer: "Aucun produit en rupture ou en rupture imminente détecté.", dataPoints: { count: 0 } };
      }
      const lines = atRisk
        .slice(0, 15)
        .map((s) => `- ${s.title}${s.daysOfStock !== null ? ` (${Math.round(s.daysOfStock)} j de stock estimé)` : " (rupture)"}`);
      return {
        answer: `${atRisk.length} produit(s) à risque :\n${lines.join("\n")}`,
        dataPoints: { productIds: atRisk.map((s) => s.productId) },
      };
    },
  },
  {
    key: "margin_bad",
    patterns: [/mauvaise marge/i, /marge (faible|négative)/i, /produits? .*marge/i],
    build: (ctx) => {
      const marginRecs = ctx.recommendations.filter((r) => r.category === "margin");
      if (marginRecs.length === 0) {
        return {
          answer: "Aucun problème de marge détecté sur les produits pour lesquels les coûts sont renseignés. Vérifiez que les hypothèses de coût sont bien à jour pour un diagnostic complet.",
          dataPoints: { count: 0 },
        };
      }
      const lines = marginRecs.slice(0, 15).map((r) => `- ${r.title} — ${r.reason}`);
      return { answer: lines.join("\n"), dataPoints: { recommendations: marginRecs.map((r) => r.id) } };
    },
  },
  {
    key: "sales_decline",
    patterns: [/ventes? baiss/i, /pourquoi.*ventes/i, /chiffre d'affaires.*baiss/i],
    build: (ctx) => {
      if (!ctx.salesTrendAvailable) {
        return {
          answer:
            "Non disponible / connexion nécessaire — l'historique de ventes n'est pas encore synchronisé pour cette boutique, je ne peux donc pas analyser une évolution. Lancez une synchronisation Shopify (commandes) pour activer cette analyse.",
          dataPoints: { available: false },
        };
      }
      return {
        answer: "Analyse d'évolution des ventes disponible dans le Dashboard et Product Intelligence — filtrez par tendance négative pour voir le détail produit par produit.",
        dataPoints: { available: true },
      };
    },
  },
  {
    key: "promote",
    patterns: [/promouvoir/i, /mettre en avant/i, /booster/i],
    build: (ctx) => {
      const opp = ctx.recommendations.filter((r) => r.severity === "OPPORTUNITY");
      if (opp.length === 0) {
        return { answer: "Aucune opportunité marketing détectée pour le moment.", dataPoints: { count: 0 } };
      }
      const lines = opp.slice(0, 10).map((r) => `- ${r.title} — ${r.impact}`);
      return { answer: lines.join("\n"), dataPoints: { recommendations: opp.map((r) => r.id) } };
    },
  },
  {
    key: "homepage",
    patterns: [/accueil/i, /page d'accueil/i, /homepage/i],
    build: (ctx) => {
      const opp = ctx.recommendations.filter((r) => r.severity === "OPPORTUNITY" || r.category === "marketing");
      if (opp.length === 0) {
        return {
          answer: "Pas assez de données pour recommander des produits pour la page d'accueil. Consultez Homepage Intelligence une fois le catalogue synchronisé.",
          dataPoints: { count: 0 },
        };
      }
      return {
        answer: `Produits recommandés pour la page d'accueil :\n${opp.slice(0, 8).map((r) => `- ${r.title}`).join("\n")}`,
        dataPoints: { recommendations: opp.map((r) => r.id) },
      };
    },
  },
  {
    key: "reviews_missing",
    patterns: [/pas assez d'avis/i, /sans avis/i, /aucun avis/i],
    build: (ctx) => {
      if (ctx.productsWithoutReviews.length === 0) {
        return { answer: "Tous les produits synchronisés ont au moins un avis.", dataPoints: { count: 0 } };
      }
      const lines = ctx.productsWithoutReviews.slice(0, 15).map((p) => `- ${p.title}`);
      return {
        answer: `${ctx.productsWithoutReviews.length} produit(s) sans avis :\n${lines.join("\n")}`,
        dataPoints: { productIds: ctx.productsWithoutReviews.map((p) => p.productId) },
      };
    },
  },
];

function severityRank(s: string): number {
  return s === "URGENT" ? 0 : s === "OPPORTUNITY" ? 1 : 2;
}
function severityLabel(s: string): string {
  return s === "URGENT" ? "🔴 URGENT" : s === "OPPORTUNITY" ? "🟠 OPPORTUNITÉ" : "🟢 SUGGESTION";
}

export function matchIntent(question: string): Intent | null {
  const normalized = question.trim();
  for (const intent of INTENTS) {
    if (intent.patterns.some((p) => p.test(normalized))) return intent;
  }
  return null;
}

export async function answerQuestion(question: string, ctx: AssistantContext): Promise<AssistantAnswer> {
  const intent = matchIntent(question);

  if (!intent) {
    return {
      question,
      matchedIntent: null,
      answer:
        "Je n'ai pas de réponse pré-configurée pour cette question précise. Questions supportées : priorités du jour, risques de rupture, marge faible, évolution des ventes, produits à promouvoir, sélection page d'accueil, produits sans avis. Reformulez selon l'une de ces thématiques pour une réponse fondée sur vos données réelles.",
      dataPoints: {},
      generatedBy: "rules",
    };
  }

  const { answer, dataPoints } = intent.build(ctx);

  // MINIMISATION DES DONNÉES (audit conformité 05/09/2026) — le texte libre
  // de la question n'est JAMAIS transmis à Anthropic : seule l'intention
  // détectée (un enum fermé, jamais du texte libre non contrôlé) part vers
  // le fournisseur IA externe. Un marchand qui coller une donnée personnelle
  // de client dans sa question ne la fait donc plus fuiter vers l'API IA —
  // la qualité de la reformulation n'en dépend pas : la réponse est de toute
  // façon entièrement dérivée de `factsText`, jamais de la question elle-même.
  const llmAnswer = await tryFormatWithLLM(intent.key, answer);
  if (llmAnswer) {
    return { question, matchedIntent: intent.key, answer: llmAnswer, dataPoints, generatedBy: "llm" };
  }

  return { question, matchedIntent: intent.key, answer, dataPoints, generatedBy: "rules" };
}

/**
 * Reformule le texte déterministe en langage plus naturel via l'API
 * Anthropic — UNIQUEMENT si ANTHROPIC_API_KEY est configurée. Le modèle ne
 * reçoit QUE l'intention détectée (enum fermé, ex. "stock_risk") et le texte
 * déjà calculé (`factsText`) comme unique source de vérité, avec
 * l'instruction explicite de ne jamais ajouter de chiffre ou de fait qui n'y
 * figure pas. Le texte libre de la question de l'utilisateur n'est JAMAIS
 * transmis ici (minimisation des données envoyées à un fournisseur IA
 * externe — audit conformité 05/09/2026). En cas d'erreur ou d'absence de
 * clé, retourne `null` et l'appelant garde la réponse déterministe (jamais
 * d'échec silencieux masqué par une réponse inventée).
 */
async function tryFormatWithLLM(intentKey: string, factsText: string): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-3-5-haiku-latest",
        max_tokens: 500,
        system:
          "Tu reformules des faits déjà calculés en une réponse claire et professionnelle en français, pour un e-commerçant. " +
          "RÈGLE ABSOLUE : n'ajoute, n'invente ni ne modifie AUCUN chiffre, nom de produit ou fait qui n'apparaît pas déjà " +
          "explicitement dans les FAITS fournis. Si les FAITS indiquent une absence de donnée, dis-le clairement au lieu de deviner.",
        messages: [
          {
            role: "user",
            content: `Intention détectée : ${intentKey}\n\nFAITS (source unique de vérité, ne rien ajouter) :\n${factsText}`,
          },
        ],
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    const text = json.content?.find((c) => c.type === "text")?.text;
    return text ?? null;
  } catch {
    return null; // dégradation silencieuse vers la réponse déterministe — jamais d'erreur exposée à l'utilisateur ici
  }
}
