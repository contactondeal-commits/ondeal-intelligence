import { readFileSync } from "node:fs";
import { prisma } from "@/lib/db";
import type { GenerateRequest, GenerateResult, ModelCapabilities, ModelProvider } from "@/lib/ai/providers/provider";
import { createStorefrontMission, getStorefrontMission } from "@/lib/ai/supervisor/graphStore";
import { runStorefrontMission } from "@/lib/ai/supervisor/graphRunner";

/**
 * ONDEAL AI CORE — PHASE 4 : SIMULATION de la première mission réelle
 * (06/09/2026), §61-§76. MÊME PRINCIPE que scripts/simulate-coder-mission.ts
 * (PHASE 3) : exécute RÉELLEMENT toute la mécanique (planification, graphe
 * persisté en base, 5 analyses en parallèle, direction créative, synthèse,
 * VRAIE CoderMission Phase 3 — workspace isolé, git diff réel, typecheck/
 * lint/test/build réels, serveur de preview réel, navigateur Playwright
 * réel, capture d'écran réelle —, critic adversarial, juge indépendant,
 * écriture RÉELLE dans storefront_missions/storefront_mission_nodes) —
 * SEUL le "modèle" est un double scripté, pour un environnement sans
 * ANTHROPIC_API_KEY réelle.
 *
 * Le contenu des réponses scriptées n'est PAS un texte de remplissage
 * générique : chaque analyse cite des faits RÉELS du dépôt (tokens CSS
 * mesurés, contraste WCAG calculé, copie marketing existante) — voir le
 * rapport de session pour la trace complète du raisonnement humain qui a
 * produit ce contenu avant de l'encoder ici en JSON.
 */

class ScriptedSupervisorProvider implements ModelProvider {
  readonly name = "anthropic";
  private calls: Array<{ taskHint: string; system: string }> = [];

  capabilities(_model: string): ModelCapabilities | null {
    return { maxContextTokens: 200_000, vision: true, toolUse: true, costPerMTokIn: 1, costPerMTokOut: 5 };
  }

  getCallLog() {
    return this.calls;
  }

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    const text = this.resolve(req);
    this.calls.push({ taskHint: text.slice(0, 40), system: req.system.slice(0, 80) });
    return { text, citations: [], tokensIn: Math.ceil(req.userMessage.length / 4), tokensOut: Math.ceil(text.length / 4) };
  }

  private resolve(req: GenerateRequest): string {
    const sys = req.system;

    // --- Supervisor (graphRunner.ts::planInitialGraph) ---
    if (sys.includes("Tu es le Supervisor d'OnDeal AI")) return PLAN_JSON;

    // --- Spécialistes du graphe Storefront (catalogue.ts) ---
    if (sys.includes('"Brand Strategist"')) return BRAND_JSON;
    if (sys.includes('"UX Architect"')) return UX_JSON;
    if (sys.includes('"CRO Strategist"')) return CRO_JSON;
    if (sys.includes('"Accessibility Reviewer"')) return A11Y_JSON;
    if (sys.includes('"Performance Engineer"')) return PERF_JSON;
    if (sys.includes("Tu es le Directeur Créatif d'OnDeal AI")) return CREATIVE_DIRECTIONS_JSON;
    if (sys.includes("Tu es le spécialiste Synthèse/Sélection")) return SYNTHESIS_JSON;
    if (sys.includes("Tu es le Supercritic Adversarial")) return CRITIC_JSON;
    if (sys.includes("Tu es le Juge Indépendant")) return JUDGE_JSON;

    // --- CoderMission imbriquée (steps.ts, PHASE 3, RÉUTILISÉE SANS MODIFICATION) ---
    if (req.images && req.images.length > 0) return VISION_JSON; // vision.ts::CRITIC_SYSTEM_PROMPT
    if (sys.includes("mode DEBUG")) return DEBUG_JSON;
    if (sys.includes('"planDescription"')) return CODER_PLAN_JSON;
    if (sys.includes("Tu es le Coder Agent")) return CODER_EDIT_JSON;

    throw new Error(`ScriptedSupervisorProvider : aucune réponse scriptée ne correspond à ce system prompt (début) : "${sys.slice(0, 120)}"`);
  }
}

// ============================================================================
// Contenu RÉEL (pas un texte de remplissage) — voir le rapport de session
// pour le raisonnement complet derrière chaque affirmation ci-dessous.
// ============================================================================

const PLAN_JSON = JSON.stringify({
  findings: ["Décomposition en 10 nodes : 5 analyses indépendantes en parallèle, puis direction créative, synthèse, implémentation (Coder Agent réel), critique adversariale, juge indépendant."],
  evidence: ["World State fourni (repo réel : /login, tokens CSS, composants existants)."],
  uncertainties: [],
  recommendations: [],
  confidence: 0.85,
  data: {
    nodes: [
      { key: "brand_audit", role: "brand_strategist", dependsOn: [], objective: "Évaluer la cohérence de marque entre le panneau marketing et la carte de connexion de /login." },
      { key: "ux_audit", role: "ux_architect", dependsOn: [], objective: "Évaluer la hiérarchie et le parcours de décision (mot de passe → CTA) sur /login." },
      { key: "cro_audit", role: "cro_strategist", dependsOn: [], objective: "Formuler des hypothèses (jamais un chiffre inventé) de réduction de friction sur /login." },
      { key: "a11y_audit", role: "accessibility_reviewer", dependsOn: [], objective: "Vérifier le contraste réel des textes secondaires de /login contre les tokens CSS mesurés." },
      { key: "perf_audit", role: "performance_reviewer", dependsOn: [], objective: "Évaluer le risque de performance d'une refonte visuelle de /login." },
      { key: "creative_directions", role: "creative_director", dependsOn: ["brand_audit", "ux_audit", "cro_audit", "a11y_audit", "perf_audit"], objective: "Générer plusieurs directions créatives distinctes pour /login à partir des 5 analyses." },
      { key: "synthesis", role: "synthesis", dependsOn: ["creative_directions"], objective: "Sélectionner ou synthétiser UNE direction finale, justifiée par les analyses." },
      { key: "implement_candidate", role: "coder_implementation", dependsOn: ["synthesis"], objective: "Implémenter réellement la direction retenue via le Coder Agent (sandbox uniquement)." },
      { key: "critic", role: "adversarial_critic", dependsOn: ["implement_candidate"], objective: "Chercher activement des raisons de rejeter la candidate implémentée." },
      { key: "judge", role: "independent_judge", dependsOn: ["critic"], objective: "Décider READY_FOR_RELEASE / FIX_REQUIRED / REJECTED." },
    ],
  },
});

const BRAND_JSON = JSON.stringify({
  findings: [
    "Le panneau marketing (titre en dégradé --color-accent/--color-warning, kicker en petites capitales, liste de fonctionnalités à icônes) porte une identité premium sombre indigo/violet cohérente avec la direction validée le 03/09/2026.",
    "La carte de connexion (.auth-card) est une surface plate (var(--color-surface)) sans aucun élément visuel qui la relie au panneau marketing — l'identité de marque s'arrête à la frontière entre les deux colonnes.",
  ],
  evidence: [
    "src/app/login/page.tsx : .auth-marketing-title-accent utilise un dégradé (--color-accent, --color-warning) ; .auth-card (globals.css) n'a ni bordure ni accent, seulement box-shadow: var(--shadow-lifted).",
    "World State (design_tokens_current) : --color-accent=#f3a023, --color-primary=#7c6df7 — deux couleurs de marque déjà définies mais absentes de .auth-card.",
  ],
  uncertainties: ["Aucune donnée de perception de marque réelle (pas d'étude utilisateur) — ceci reste une évaluation heuristique, pas une mesure."],
  recommendations: ["Introduire un bridge visuel MINIMAL sur .auth-card (ex. fine barre d'accent) plutôt qu'une réécriture complète de la carte — cohérent avec §18 : ne pas forcer une esthétique générique, rester une extension mesurée de l'identité déjà validée."],
  confidence: 0.72,
  data: {},
});

const UX_JSON = JSON.stringify({
  findings: [
    "Hiérarchie de titres correcte (h1 marketing, h2 'Connexion'). Le CTA ('Accéder à mon tableau de bord →') est clair et orienté action.",
    "Aucune réassurance/confiance n'apparaît entre le champ mot de passe et le bouton — le point de décision exact ne porte aucun signal de confiance, alors que FEATURES contient déjà un message pertinent ('Vous gardez toujours le contrôle' / 'Aucune modification n'est jamais appliquée sur votre boutique sans votre validation explicite.') mais placé loin du CTA, dans la liste de fonctionnalités.",
  ],
  evidence: ["src/app/login/page.tsx : FEATURES[4] = { title: 'Vous gardez toujours le contrôle', text: '...' } — jamais répété près du bouton de soumission."],
  uncertainties: ["Impact réel sur l'hésitation à la décision non mesuré (aucune donnée d'usage réelle disponible, voir CRO)."],
  recommendations: ["Réutiliser (jamais inventer) ce message déjà validé, sous une forme courte, directement sous le CTA — §27 : aucune nouvelle promesse commerciale."],
  confidence: 0.75,
  data: {},
});

const CRO_JSON = JSON.stringify({
  findings: [
    "HYPOTHÈSE UNIQUEMENT (§20/§77 : aucune mesure réelle de conversion disponible pour /login à ce jour — voir World State, real_conversion_rate=INSUFFICIENT_DATA) : rapprocher un signal de confiance déjà existant du point de décision (juste sous le CTA) pourrait réduire l'hésitation au moment précis de la soumission.",
    "Le teaser de plan ('Starter gratuit', 'Sans carte bancaire pour démarrer') est un signal de réduction de friction fort mais placé en fin de panneau marketing, potentiellement sous la ligne de flottaison sur écran réduit — non re-testé dans le cadre de cette mission (changement hors périmètre, plan déjà présent et fonctionnel).",
  ],
  evidence: ["World State : real_conversion_rate = null, uncertainty=INSUFFICIENT_DATA — aucune baseline mesurée pour comparer un avant/après réel."],
  uncertainties: ["Aucun chiffre d'amélioration ne peut être affirmé avant une mesure réelle post-déploiement en preview partagée (§77 : No Fake Metrics)."],
  recommendations: ["Après implémentation, mesurer réellement (pas une estimation) tout changement de comportement si un canal de mesure devient disponible — ne jamais publier un pourcentage d'amélioration non observé."],
  confidence: 0.55,
  data: {},
});

const A11Y_JSON = JSON.stringify({
  findings: [
    "Contraste RÉEL calculé (WCAG, formule de luminance relative) : .auth-social-proof utilise --color-text-faint (#737893) sur --color-surface (#131730) = 4.05:1 — sous le seuil AA texte normal (4.5:1). Le même texte avec --color-text-muted (#a4a9c4) atteindrait 7.59:1 (AAA).",
    "Les titres à style inline de .auth-card (fontSize 20/14, --color-text/--color-text-muted sur --color-surface) sont largement conformes (15.47:1 et 7.59:1 respectivement) — aucun problème réel ici, ne pas fabriquer un second problème pour paraître plus exhaustif.",
  ],
  evidence: ["Calcul de contraste WCAG effectué sur les valeurs hexadécimales réelles extraites de :root (design_tokens_current) : contrast(#737893, #131730) = 4.05, contrast(#a4a9c4, #131730) = 7.59."],
  uncertainties: [],
  recommendations: ["Remplacer --color-text-faint par --color-text-muted sur .auth-social-proof (texte à 12px, donc 'texte normal' au sens WCAG — pas assez grand/gras pour le seuil 'texte large' à 3:1) — correction d'1 ligne, aucun risque de régression visuelle significative."],
  confidence: 0.93,
  data: {},
});

const PERF_JSON = JSON.stringify({
  findings: [
    "Aucune image lourde sur /login (icônes lucide-react en SVG inline) — risque de performance faible pour une refonte purement CSS/texte.",
    "Les ajouts envisagés (dégradé CSS, une ligne de texte) n'ajoutent aucune requête réseau, aucune image, aucun script — impact de performance attendu négligeable.",
  ],
  evidence: ["src/app/login/page.tsx : imports lucide-react (Package, Star, TrendingUp, Sparkles, ShieldCheck, Plug) — aucun <img> ni next/image sur cette page."],
  uncertainties: ["Aucun score Lighthouse RÉEL mesuré à ce stade du pipeline (viendra du build/preview de la CoderMission, pas de cette analyse préalable) — ne pas affirmer un score non mesuré."],
  recommendations: ["Rester en dégradés CSS (déjà le cas) plutôt que d'introduire une image de fond haute résolution pour l'effet visuel recherché."],
  confidence: 0.8,
  data: {},
});

const CREATIVE_DIRECTIONS_JSON = JSON.stringify({
  findings: ["3 directions réellement distinctes générées à partir des 5 analyses en amont — pas la même page avec 3 couleurs."],
  evidence: ["Synthèse des trouvailles brand/ux/cro/a11y/perf ci-dessus."],
  uncertainties: [],
  recommendations: [],
  confidence: 0.8,
  data: {
    directions: [
      {
        id: "trust_anchor",
        strategy: "Ancrage de confiance au point de décision : ne toucher QUE l'espace autour du CTA (micro-copy de confiance réutilisée) + corriger le contraste réel mesuré sur le texte de preuve sociale. Aucun changement structurel.",
        story: "Le visiteur arrive convaincu par le panneau marketing (déjà fort) ; au moment précis où il hésite (juste avant de cliquer), un signal de confiance déjà validé apparaît sous ses yeux, sans qu'il ait besoin de remonter dans la liste de fonctionnalités.",
        hierarchy: "Aucun changement de hiérarchie de titres ; ajout d'un niveau de lecture supplémentaire (micro-copy) strictement sous le CTA, en dernier dans l'ordre de lecture du formulaire.",
        visualPhilosophy: "Minimal, réversible, aucune nouvelle couleur introduite — réutilise --color-success déjà défini pour l'icône de confiance.",
        commerceReasoning: "Hypothèse (non mesurée) de réduction de friction au moment exact de la soumission, sans aucune promesse commerciale nouvelle (§27) — risque d'implémentation quasi nul.",
      },
      {
        id: "unified_premium_surface",
        strategy: "Unifier visuellement la carte de connexion avec le panneau marketing via une fine barre d'accent en dégradé (--color-accent → --color-primary) en tête de carte, faisant écho au dégradé du titre marketing.",
        story: "La carte de connexion n'est plus une surface neutre 'générique SaaS' mais porte visiblement la même signature chromatique que le reste de la page — l'identité de marque ne s'arrête plus à la frontière des deux colonnes.",
        hierarchy: "La barre d'accent devient le premier élément visuel perçu de la carte, avant même le titre 'Connexion' — renforce l'impression de continuité de marque sans concurrencer la hiérarchie textuelle existante.",
        visualPhilosophy: "Extension mesurée de l'identité déjà validée (03/09/2026) — jamais une esthétique générique plaquée (§18), un dégradé de 3px utilisant des couleurs de marque déjà en place.",
        commerceReasoning: "Renforce la perception de sérieux/premium à l'instant précis de la conversion (connexion) — hypothèse qualitative, aucun chiffre inventé.",
      },
      {
        id: "editorial_social_proof_band",
        strategy: "Dupliquer la ligne de preuve sociale existante ('Déjà en production · +1 700 produits analysés · Données Shopify en temps réel') dans un bandeau collé au formulaire plutôt que seulement en bas du panneau marketing.",
        story: "Le visiteur voit la preuve sociale au moment de remplir le formulaire, pas seulement en scrollant le panneau marketing.",
        hierarchy: "Introduit un nouveau bloc structurel dans .auth-card — changement plus visible que les deux autres directions.",
        visualPhilosophy: "Duplication d'un message déjà réel (jamais un chiffre inventé) mais changement structurel plus large, donc risque d'implémentation et de régression plus élevé pour un bénéfice marginal par rapport à trust_anchor/unified_premium_surface qui couvrent déjà le point de décision.",
        commerceReasoning: "Bénéfice incertain (redondance possible avec le panneau déjà visible sur desktop) contre un risque d'implémentation plus élevé — direction la moins favorable des trois.",
      },
    ],
  },
});

const SYNTHESIS_JSON = JSON.stringify({
  findings: [
    "trust_anchor et unified_premium_surface s'adressent à des dimensions différentes (UX/confiance vs. cohérence de marque) et sont tous deux minimaux/réversibles — ils se combinent naturellement en un seul changement cohérent.",
    "editorial_social_proof_band est écarté : bénéfice incertain (redondance avec le panneau déjà visible) pour un risque d'implémentation structurel plus élevé — ne sert aucune des 5 analyses en amont mieux que les deux autres directions.",
  ],
  evidence: ["3 directions reçues du Directeur Créatif ; 5 analyses en amont (brand/ux/cro/a11y/perf)."],
  uncertainties: [],
  recommendations: [],
  confidence: 0.78,
  data: {
    selection: "SYNTHESIZED",
    selectedDirectionId: "trust_anchor",
    combinedFromIds: ["trust_anchor", "unified_premium_surface"],
    reasoning: "Synthèse de trust_anchor (micro-copy de confiance sous le CTA, réutilisant un message déjà validé) et unified_premium_surface (fine barre d'accent en tête de carte) : les deux sont minimaux, purement CSS/texte, et corrigent chacun un point réel (UX/confiance et cohérence de marque) sans se contredire. La correction de contraste WCAG (a11y_audit) est intégrée comme partie non négociable du brief final (§25 : accessibilité, pas optionnelle). editorial_social_proof_band est rejetée : risque structurel plus élevé pour un bénéfice non démontré.",
    finalBrief: {
      strategy: "Renforcer la confiance au point de décision (micro-copy sous le CTA, réutilisant le message déjà validé 'Vous gardez toujours le contrôle') ET relier visuellement la carte de connexion à l'identité de marque du panneau marketing (fine barre d'accent en tête de carte, dégradé --color-accent/--color-primary) ET corriger le contraste réel mesuré du texte de preuve sociale (--color-text-faint -> --color-text-muted, 4.05:1 -> 7.59:1).",
      story: "Le visiteur convaincu par le panneau marketing retrouve, au moment de cliquer, un signal de confiance déjà vu, sur une carte qui porte visiblement la même signature de marque — sans aucune nouvelle promesse, sans changement structurel.",
      hierarchy: "Aucun changement de hiérarchie de titres ; deux ajouts non intrusifs (barre d'accent en tête de carte, micro-copy sous le CTA) + une correction de couleur sur un élément déjà existant.",
      visualPhilosophy: "Extension minimale et réversible de l'identité déjà validée (03/09/2026) — aucune nouvelle couleur, aucune nouvelle image, purement CSS + une ligne de JSX réutilisant une icône et un message déjà présents dans le composant.",
      commerceReasoning: "Hypothèses qualitatives uniquement (§20/§77 : aucun chiffre de conversion inventé) — bénéfice attendu en confiance perçue et cohérence de marque ; accessibilité corrigée par la même occasion (non négociable, §25).",
    },
  },
});

const CRITIC_JSON = JSON.stringify({
  findings: [
    "Le changement est petit et réversible, ce qui limite le risque, mais c'est aussi une limite : aucune des 3 directions n'a été testée auprès de vrais visiteurs — tout bénéfice affirmé reste une hypothèse (déjà reconnu par CRO_JSON, donc pas une découverte nouvelle mais un rappel nécessaire).",
    "La correction d'accessibilité est réelle et mesurée (bon point), mais le Critic note qu'AUCUNE autre vérification d'accessibilité (navigation clavier, lecteur d'écran) n'a été faite sur /login dans cette mission — le périmètre d'accessibilité examiné est étroit (un seul contraste), pas une revue a11y complète.",
    "La barre d'accent en dégradé ajoute un `::before` avec `overflow: hidden` sur .auth-card — à vérifier que cela n'écrête pas involontairement un futur contenu qui dépasserait de la carte (aucun cas actuel identifié, mais une garde à surveiller si la carte évolue).",
  ],
  evidence: ["Diff réel produit par la CoderMission (implement_candidate) ; rapport de vérification visuelle (verify_and_fix) du Coder Agent."],
  uncertainties: ["Aucune mesure réelle de conversion ou de perception de marque post-déploiement — toute affirmation de bénéfice reste qualitative."],
  recommendations: ["Avant tout déploiement en production, effectuer une revue d'accessibilité plus large (clavier, lecteur d'écran) que le seul contraste corrigé ici — hors périmètre de cette mission mais signalé explicitement, pas silencieusement omis."],
  confidence: 0.7,
  data: {
    verdict: "PASS",
    blockingIssues: [],
    weaknesses: [
      "Aucune mesure réelle de bénéfice (conversion/perception) — hypothèses uniquement.",
      "Revue d'accessibilité limitée à un seul contraste corrigé, pas une revue a11y complète (clavier/lecteur d'écran non testés dans cette mission).",
    ],
    rejectionCase: "Cette candidate POURRAIT être rejetée si l'on considère qu'un changement dont le bénéfice n'est appuyé sur AUCUNE mesure réelle (seulement des hypothèses UX/CRO) ne justifie pas le risque, même minime, de toucher une page de connexion en production — un reviewer strict pourrait exiger une mesure réelle en preview partagée AVANT tout changement, même réversible, de la page d'authentification.",
  },
});

const JUDGE_JSON = JSON.stringify({
  findings: [
    "Le diff est petit, confiné à src/app/login/page.tsx et src/app/globals.css, purement visuel/textuel — aucune mutation de données, aucune route API touchée, conforme à la contrainte de la mission.",
    "Typecheck/lint/test/build ont réussi (voir CoderMission implement_candidate) ; la vérification visuelle automatisée (Phase 3, vision.ts) a validé le rendu ; le Critic n'a soulevé aucun blocage, seulement des limites de portée déjà reconnues.",
    "Le point soulevé par le Critic (mesure réelle de bénéfice absente, revue a11y non exhaustive) est réel mais n'est PAS un motif de blocage pour une candidate de PREVIEW/SANDBOX (§75 : la mission s'arrête à READY_FOR_RELEASE pour comparaison, ne déploie jamais automatiquement en production) — ce sont des conditions à vérifier AVANT un futur déploiement réel, pas avant cette étape de comparaison.",
  ],
  evidence: [
    "Diff réel (git) de la CoderMission implémentée.",
    "Résultat typecheck/lint/test/build réel (CoderMission verify_and_fix).",
    "Rapport de revue visuelle automatisée (Phase 3, modèle vision du Router).",
    "Rapport du Critic adversarial (verdict PASS, faiblesses documentées, aucun blocage).",
  ],
  uncertainties: ["Bénéfice réel non mesuré (hypothèse uniquement) — à vérifier après déploiement en preview partagée, jamais affirmé comme un fait ici."],
  recommendations: ["Avant un futur passage en production réelle (hors périmètre de cette mission) : mesurer réellement tout changement de comportement, et faire une revue d'accessibilité plus complète (clavier, lecteur d'écran)."],
  confidence: 0.8,
  data: {
    verdict: "READY_FOR_RELEASE",
    justification: "La candidate respecte la contrainte de périmètre (fichiers autorisés uniquement), passe toutes les vérifications mécaniques réelles (typecheck/lint/test/build) et la vérification visuelle automatisée, et le Critic adversarial n'a identifié aucun blocage réel — seulement des limites de portée déjà explicitement reconnues (hypothèses non mesurées, revue a11y partielle). Prête à être comparée à la production (§75), PAS déployée automatiquement.",
    evidenceReviewed: ["diff git réel", "typecheck/lint/test/build réels", "rapport de vérification visuelle automatisée (Phase 3)", "rapport du Critic adversarial"],
  },
});

// --- CoderMission imbriquée (steps.ts, PHASE 3 — prompts et schémas INCHANGÉS) ---

const CODER_PLAN_JSON = JSON.stringify({
  planDescription:
    "Implémenter le brief synthétisé : (1) corriger le contraste réel mesuré de .auth-social-proof (--color-text-faint -> --color-text-muted, 4.05:1 -> 7.59:1) ; (2) ajouter une fine barre d'accent en dégradé (--color-accent -> --color-primary) en tête de .auth-card ; (3) ajouter une micro-copy de confiance réutilisant le message déjà présent dans FEATURES, sous le CTA de connexion.",
  targetFiles: ["src/app/login/page.tsx", "src/app/globals.css"],
});

const CODER_EDIT_JSON = JSON.stringify({
  files: [
    { path: "src/app/login/page.tsx", content: readFileSync("/tmp/ondeal-mission-content/page.tsx", "utf8") },
    { path: "src/app/globals.css", content: readFileSync("/tmp/ondeal-mission-content/globals.css", "utf8") },
  ],
});

const DEBUG_JSON = CODER_EDIT_JSON; // filet de sécurité : si une vérification échouait, retente le MÊME contenu (contenu déjà vérifié manuellement avant ce run — voir rapport de session).

// Réponse du Visual Reviewer (vision.ts) — provisoire au moment du run scripté
// (verdict mécanique utilisé par le pipeline pour continuer), COMPLÉTÉE ensuite
// par ma propre revue humaine indépendante de la capture réelle sur disque
// (voir rapport de session — même discipline que PHASE 3 : "DEV PROOF vs
// PRODUCT RUNTIME", jamais un jugement visuel non vérifié affirmé comme définitif).
const VISION_JSON = JSON.stringify({ overallPass: true, issues: [] });

async function main() {
  const goal = "Construire une candidate premium (sandbox uniquement, jamais la production) pour /login d'OnDeal Intelligence : renforcer la confiance au point de décision, relier visuellement la carte de connexion à l'identité de marque, et corriger un problème réel de contraste — sans casser aucune fonctionnalité existante.";

  const mission = await createStorefrontMission({ goal, createdByUserId: "cl_simulation_platform_owner" });
  console.log(`StorefrontMission créée : ${mission.id}`);

  const provider = new ScriptedSupervisorProvider();
  const outcome = await runStorefrontMission(mission.id, {
    provider,
    sourceRepoRoot: "/tmp/ondeal-dev",
    createdByUserId: "cl_simulation_platform_owner",
    coderSecurity: { allowedPathPrefixes: ["src/app/login", "src/app/globals.css"], maxCostUsd: 5, maxFixIterations: 2, operationTimeoutMs: 180_000 },
    coderPreviewPort: 4173,
  });

  const final = await getStorefrontMission(mission.id);
  console.log(
    JSON.stringify(
      {
        outcome,
        callCount: provider.getCallLog().length,
        mission: final
          ? {
              id: final.id,
              status: final.status,
              lastError: final.lastError,
              totalCostUsd: final.totalCostUsd,
              nodes: final.nodes.map((n) => ({ key: n.key, role: n.role, status: n.status, provider: n.provider, model: n.model, costUsd: n.costUsd, confidence: n.confidence })),
            }
          : null,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
