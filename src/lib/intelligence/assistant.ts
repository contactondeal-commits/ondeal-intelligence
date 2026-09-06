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
  // ---------------------------------------------------------------------
  // CORRECTIF 05/09/2026 v4 — intentions "comment faire" (aide
  // opérationnelle). Ajoutées après le constat direct (capture d'écran
  // utilisateur) que l'assistant répondait "je n'ai pas de réponse
  // pré-configurée" en boucle à "comment archiver un produit ?" /
  // "comment supprimer un produit ?" — des questions parmi les plus
  // basiques qu'un marchand puisse poser. Réponses 100% déterministes et
  // exactes (jamais confiées au LLM, contrairement au repli ouvert
  // ci-dessous) car il s'agit d'instructions opérationnelles précises sur
  // CE QUE L'APP PERMET RÉELLEMENT AUJOURD'HUI — une hallucination ici
  // enverrait un marchand cliquer un bouton qui n'existe pas.
  {
    key: "how_to_archive_or_delete_product",
    patterns: [/archiv/i, /supprim.*(produit|catalogue|fiche)/i, /retirer.*(vente|catalogue)/i, /d[ée]publier/i, /ne .*(vend|commercialise) plus/i],
    build: () => ({
      answer:
        "Archiver ou dépublier un produit (le retirer de la vente sans le supprimer) : ouvrez sa fiche Product Intelligence — un bouton « Archiver » ou « Mettre en brouillon » y exécute directement le changement sur Shopify, avec confirmation. Republier fonctionne pareil, en sens inverse.\n" +
        "Supprimer définitivement un produit : cette action n'est PAS encore disponible depuis OnDeal (elle est irréversible et nécessite un garde-fou que l'équipe met en place) — faites-le depuis Shopify (Produits → sélectionner → Plus d'actions → Supprimer). OnDeal se resynchronise automatiquement ensuite et ne montrera plus le produit supprimé.",
      dataPoints: { capability: "product_status", deleteAvailable: false },
    }),
  },
  {
    key: "how_to_edit_stock",
    patterns: [/modifier.*stock/i, /changer.*stock/i, /ajuster.*stock/i, /corriger.*stock/i, /mettre à jour.*stock/i],
    build: () => ({
      answer:
        "Modifier une quantité en stock : allez sur la page Stock, cliquez « Modifier » sur la ligne du produit concerné, saisissez la nouvelle quantité puis confirmez — la mise à jour est écrite directement sur Shopify (réservé aux boutiques Shopify connectées). Pour corriger plusieurs ruptures d'un coup, utilisez « Sécuriser mes ruptures » en haut de la page Stock.",
      dataPoints: { capability: "update_stock" },
    }),
  },
  {
    key: "how_to_connect_integration",
    patterns: [/connecter.*(shopify|google analytics|cjdropshipping|int[ée]gration)/i, /comment.*(connecter|activer).*(shopify|analytics|cjdropshipping)/i],
    build: () => ({
      answer:
        "Toutes les connexions (Shopify, Google Analytics, CJdropshipping) se font depuis Paramètres > Intégrations : cliquez sur le service concerné et suivez l'autorisation. Une fois connecté, la prochaine synchronisation (automatique 4×/jour, ou le bouton « Synchroniser ») remplit les données réelles correspondantes.",
      dataPoints: { capability: "integrations" },
    }),
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

/**
 * Liste affichée à l'utilisateur ET injectée dans le prompt système du
 * repli ouvert (voir tryOpenAnswer) — une SEULE source de vérité pour ne
 * jamais laisser le message d'aide et les instructions données au LLM
 * diverger sur ce que l'app permet réellement.
 */
const SUPPORTED_TOPICS =
  "priorités du jour, risques de rupture, marge faible, évolution des ventes, produits à promouvoir, sélection page d'accueil, produits sans avis, comment archiver/dépublier/republier un produit, comment modifier le stock, comment connecter une intégration";

export async function answerQuestion(question: string, ctx: AssistantContext): Promise<AssistantAnswer> {
  const intent = matchIntent(question);

  if (!intent) {
    // CORRECTIF 05/09/2026 v4 — repli OUVERT (avant : message générique
    // identique en boucle, quelle que soit la question, constaté inutile
    // par l'utilisateur sur une capture d'écran réelle). Contrairement à
    // `tryFormatWithLLM` ci-dessous (reformulation d'un texte déjà calculé,
    // AUCUN texte libre transmis à Anthropic — minimisation des données,
    // audit conformité 05/09/2026 v1), ce repli-ci transmet la question
    // elle-même : c'est la seule façon pour le modèle de comprendre CE QUI
    // est demandé plutôt que de réciter un rapport figé. Exception
    // consciente et documentée à la règle de minimisation — nécessaire à
    // "un assistant qui comprend n'importe quelle question", jamais
    // silencieuse (voir AssistantChat.tsx pour l'avertissement affiché à
    // l'utilisateur). Reste borné : aucune donnée n'est INVENTÉE — le
    // modèle ne reçoit QUE les faits déjà calculés (factsText), avec
    // instruction explicite de répondre "je n'ai pas cette donnée dans
    // OnDeal" pour tout ce qui n'y figure pas (prix concurrents, données
    // externes au catalogue synchronisé, etc.).
    const factsText = buildStoreFactsText(ctx);
    const openAnswer = await tryOpenAnswer(question, factsText);
    if (openAnswer) {
      return { question, matchedIntent: null, answer: openAnswer, dataPoints: { open: true }, generatedBy: "llm" };
    }
    return {
      question,
      matchedIntent: null,
      answer: `Je n'ai pas pu formuler de réponse ouverte pour cette question (IA non configurée ou indisponible pour l'instant). Questions garanties avec réponse fondée sur vos données réelles : ${SUPPORTED_TOPICS}. Reformulez selon l'une de ces thématiques, ou réessayez dans un instant.`,
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
        // Modèle rapide/économique (correctif 05/09/2026 v4 — l'ancien
        // "claude-3-5-haiku-latest" n'est plus un identifiant courant) :
        // suffisant ici car la tâche est une PURE reformulation d'un texte
        // déjà entièrement calculé, jamais un raisonnement nouveau.
        model: "claude-haiku-4-5-20251001",
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

/**
 * Compose un résumé RÉEL et déjà calculé de l'état de la boutique — jamais
 * une nouvelle formule, uniquement une agrégation lisible des mêmes
 * structures que les intentions ci-dessus (recommendations/stock/
 * pageProduct). Sert de SEULE source de vérité au repli ouvert
 * (`tryOpenAnswer`) : le modèle ne voit jamais la base de données, jamais
 * une donnée boutique en dehors de ce texte.
 */
function buildStoreFactsText(ctx: AssistantContext): string {
  const lines: string[] = [`Boutique : ${ctx.storeName}`];

  const top = [...ctx.recommendations].sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || b.confidence - a.confidence).slice(0, 12);
  if (top.length > 0) {
    lines.push(`Recommandations actives (${ctx.recommendations.length} au total, 12 les plus prioritaires ci-dessous) :`);
    for (const r of top) lines.push(`- [${severityLabel(r.severity)}] (${r.category}) ${r.title} — ${r.reason}`);
  } else {
    lines.push("Recommandations actives : aucune actuellement.");
  }

  const atRisk = ctx.stock.filter((s) => s.status === "rupture" || s.status === "rupture_imminente");
  lines.push(atRisk.length > 0 ? `Stock à risque : ${atRisk.length} produit(s) en rupture ou rupture imminente.` : "Stock à risque : aucun produit en rupture détecté.");

  lines.push(
    ctx.salesTrendAvailable
      ? "Historique de ventes : synchronisé, analyse d'évolution disponible dans Dashboard/Product Intelligence."
      : "Historique de ventes : pas encore synchronisé pour cette boutique (aucune analyse d'évolution possible tant que ce n'est pas fait).",
  );

  lines.push(
    ctx.productsWithoutReviews.length > 0
      ? `Produits sans avis : ${ctx.productsWithoutReviews.length}.`
      : "Produits sans avis : aucun (ou aucun produit synchronisé avec avis suivis).",
  );

  if (ctx.pageProduct) {
    const p = ctx.pageProduct;
    lines.push(
      `Produit actuellement consulté : "${p.title}" — score ${p.score ?? "non calculé"}/100, ` +
        `marge ${p.marginGatedByPlan ? "réservée au plan Pro+" : p.avgMarginRatePct !== null ? `${p.avgMarginRatePct.toFixed(1)}%` : "non calculable (coût manquant)"}, ` +
        `stock ${p.stockTotal ?? "inconnu"}, ventes sur ${p.salesWindowDays}j : ${p.salesUnitsSold} unité(s)/${p.salesRevenue.toFixed(2)}€` +
        (p.salesTrendLabel ? ` (${p.salesTrendLabel} vs période précédente)` : " (historique insuffisant pour une tendance)."),
    );
  }

  return lines.join("\n");
}
/**
 * Repli ouvert — utilise le modèle Claude le plus capable disponible
 * ("Fable 5.1", demande explicite de l'utilisateur du 05/09/2026 : "l'IA la
 * plus performante possible"), pour raisonner/conseiller librement à partir
 * des FAITS réels fournis (jamais d'accès direct à la base). Deux garde-fous
 * non négociables donnés au modèle : (1) ne jamais présenter comme un fait
 * quoi que ce soit d'absent des FAITS (prix concurrents, données externes,
 * disponibilité fournisseur non synchronisée, etc.) — dire honnêtement
 * "OnDeal n'a pas cette donnée" plutôt que deviner ; (2) ne jamais prétendre
 * qu'une action a été effectuée — seules des instructions ("allez sur telle
 * page, cliquez tel bouton") à partir de la liste figée CAPACITÉS ci-dessous,
 * jamais une action inventée qui n'existe pas dans l'app.
 */
interface OpenAnswerTextBlock {
  type: string;
  text?: string;
  citations?: Array<{ type: string; url?: string; title?: string }>;
}

/**
 * CORRECTIF 05/09/2026 v5 — recherche web en direct (demande explicite :
 * "il doit pouvoir aller voir ailleurs que les chiffres de la boutique
 * connectée", ex. prix concurrent pour juger si un tarif OnDeal est
 * compétitif). Utilise l'outil serveur Anthropic natif `web_search` — Claude
 * exécute lui-même la recherche, pas de scraping ni de clé tierce à gérer
 * ici. VOLONTAIREMENT DÉSACTIVÉ PAR DÉFAUT (variable d'env
 * `ONDEAL_ENABLE_WEB_SEARCH=true`) : ce tool doit AUSSI être activé côté
 * organisation Anthropic (console > Settings > Privacy) — sans ça, toute
 * requête l'utilisant échoue en 400. Le laisser branché par défaut aurait
 * cassé le repli ouvert (données réelles boutique) pour toute organisation
 * ne l'ayant pas encore activé côté Anthropic — d'où ce double interrupteur
 * explicite plutôt qu'une activation silencieuse.
 *
 * Coût réel (facturé par Anthropic à la boutique, sur SA clé API) : 10 $ /
 * 1000 recherches + le coût token habituel du contenu trouvé — plafonné ici
 * à `WEB_SEARCH_MAX_USES` recherches par question pour borner le coût d'un
 * seul clic.
 */
const WEB_SEARCH_MAX_USES = 3;

// PHASE 5 (06/09/2026) — exporté : le Supervisor (supervisor/catalogue.ts,
// rôle "researcher") réutilise EXACTEMENT ce même gate plutôt que d'inventer
// un second mécanisme d'activation de la recherche web — un seul interrupteur
// ONDEAL_ENABLE_WEB_SEARCH pour toute l'application, jamais deux.
export function webSearchEnabled(): boolean {
  return process.env.ONDEAL_ENABLE_WEB_SEARCH === "true";
}

async function tryOpenAnswer(question: string, factsText: string): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const trimmedQuestion = question.trim().slice(0, 2000); // garde-fou taille, jamais un texte illimité transmis
  const useWebSearch = webSearchEnabled();

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        // Modèle le plus capable disponible (demande explicite utilisateur
        // 05/09/2026 v4) — réservé à CE repli, jamais aux intentions
        // fermées ci-dessus (reformulation pure, haiku suffit largement).
        model: "claude-fable-5-1",
        max_tokens: 900,
        system:
          "Tu es l'assistant IA d'OnDeal Intelligence, un outil d'aide à la décision pour marchands e-commerce (Shopify/WooCommerce/PrestaShop). " +
          "Réponds en français, de façon directe et utile, à la question du marchand.\n\n" +
          "RÈGLE ABSOLUE N°1 (jamais d'exception) : les FAITS ci-dessous sont ta SEULE source de données réelles SUR CETTE BOUTIQUE " +
          "(catalogue, stock, marge, ventes). N'invente, ne suppose ni n'estime AUCUN chiffre, nom de produit, prix, stock ou fait " +
          "concernant CETTE boutique qui n'y figure pas explicitement.\n\n" +
          (useWebSearch
            ? "RÈGLE ABSOLUE N°2 : pour toute information EXTERNE à la boutique (prix pratiqué par un concurrent, tendance du marché, " +
              "disponibilité chez un fournisseur), tu DOIS utiliser l'outil de recherche web fourni plutôt que deviner à partir de ta " +
              "connaissance générale — les prix en ligne changent en permanence, une estimation de mémoire serait probablement fausse. " +
              "Distingue TOUJOURS explicitement, dans ta réponse, ce qui vient des FAITS boutique (réel, calculé par OnDeal) de ce qui " +
              "vient d'une recherche web (préfixe visible \"[Web]\", avec la source citée) — ne jamais mélanger les deux sans le dire. " +
              "Si la recherche web ne trouve rien d'exploitable, dis-le honnêtement au lieu d'inventer un prix concurrent.\n\n"
            : "RÈGLE ABSOLUE N°2 : la recherche web n'est PAS activée sur ce compte. Si la question porte sur une donnée externe " +
              "(prix d'un concurrent, tendance du marché, disponibilité fournisseur non connecté), dis clairement : \"OnDeal n'a pas " +
              "cette donnée aujourd'hui\" — jamais une estimation présentée comme réelle.\n\n") +
          "RÈGLE ABSOLUE N°3 : tu peux conseiller et raisonner librement (stratégie de prix, priorisation, explications), mais jamais " +
          "prétendre qu'une action a été exécutée. Pour une question \"comment faire X\" dans l'app, ne renvoie QUE vers une capacité " +
          "qui existe RÉELLEMENT aujourd'hui — voir CAPACITÉS ACTUELLES ci-dessous — jamais un bouton ou une page inventée.\n\n" +
          "CAPACITÉS ACTUELLES DE L'APPLICATION (liste exhaustive — ne rien inventer au-delà) :\n" +
          "- Archiver / mettre en brouillon / republier un produit : fiche Product Intelligence du produit (mutation Shopify réelle, avec confirmation).\n" +
          "- Modifier une quantité en stock : page Stock (édition en ligne par produit) ou « Sécuriser mes ruptures » en masse.\n" +
          "- Changer un prix : page Prix & Marge (Decision Workspace), individuellement ou en masse sur une sélection.\n" +
          "- Connecter Shopify / Google Analytics / CJdropshipping : Paramètres > Intégrations.\n" +
          "- PAS ENCORE disponible : suppression définitive d'un produit (à faire depuis Shopify directement) ; recherche d'image ou de fournisseur.\n\n" +
          `FAITS (données réelles de cette boutique, source unique de vérité pour tout ce qui la concerne) :\n${factsText}`,
        messages: [{ role: "user", content: trimmedQuestion }],
        ...(useWebSearch
          ? { tools: [{ type: "web_search_20250305", name: "web_search", max_uses: WEB_SEARCH_MAX_USES }] }
          : {}),
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { content?: OpenAnswerTextBlock[] };
    const textBlocks = (json.content ?? []).filter((c) => c.type === "text" && c.text);
    if (textBlocks.length === 0) return null;
    const answer = textBlocks.map((b) => b.text).join("\n");

    // Citations obligatoires (politique Anthropic sur les résultats de
    // recherche web) — dédupliquées, ajoutées lisiblement en pied de
    // réponse plutôt que noyées dans le texte.
    const sources = new Map<string, string>();
    for (const block of textBlocks) {
      for (const cite of block.citations ?? []) {
        if (cite.url && !sources.has(cite.url)) sources.set(cite.url, cite.title ?? cite.url);
      }
    }
    if (sources.size === 0) return answer;
    const sourceLines = [...sources.entries()].map(([url, title]) => `- ${title} (${url})`);
    return `${answer}\n\nSources (recherche web en direct — à vérifier, prix susceptibles d'avoir changé) :\n${sourceLines.join("\n")}`;
  } catch {
    return null; // dégradation silencieuse vers le message de repli déterministe — jamais d'erreur brute exposée
  }
}
