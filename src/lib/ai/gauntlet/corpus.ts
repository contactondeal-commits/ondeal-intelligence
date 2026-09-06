import type { GauntletTask } from "@/lib/ai/gauntlet/types";

/**
 * ONDEAL GAUNTLET — corpus de départ (06/09/2026).
 *
 * Quatre tâches, toutes RÉELLEMENT accomplies dans OnDeal Intelligence —
 * tirées de cette session et d'un document de session existant du Project
 * (traçabilité en `source`), jamais inventées. Volontairement court : la
 * valeur de ce corpus n'est pas sa taille mais la preuve que le format
 * GauntletTask capture des tâches réelles avec un critère vérifiable — un
 * corpus plus large est un travail FUTURE, pas une fondation.
 */
export const GAUNTLET_CORPUS: GauntletTask[] = [
  {
    id: "set_product_status_mutation",
    category: "coding",
    description:
      "Implémenter executeSetProductStatus(storeId, payload) dans src/app/api/actions/[id]/execute/route.ts : valider productId/targetStatus (ACTIVE|DRAFT|ARCHIVED), appeler updateProductStatus (Shopify), mettre à jour Product.status en base, retourner un ExecutionOutcome typé avec before/applied/verified — jamais une exécution simulée.",
    source: "Session 05-06/09/2026 — chantier « archiver/republier un produit », fichier 3/10 déployé (commit 0d3e25d).",
    expectedCriteria: [
      "tsc --noEmit ne rapporte aucune erreur sur le fichier modifié",
      "vitest run tests/actionKind.test.ts passe (dont le cas set_product_status)",
      "ExecutionOutcome retourné contient before, applied ET verified — jamais une valeur inventée si Shopify échoue",
    ],
  },
  {
    id: "assistant_open_fallback_disclosure",
    category: "architecture",
    description:
      "Ajouter à l'assistant IA (src/lib/intelligence/assistant.ts) un repli ouvert (LLM, recherche web optionnelle) UNIQUEMENT quand aucune intention fermée ne correspond, sans jamais laisser le repli répondre à une question déjà couverte par le moteur de règles déterministe, et sans jamais présenter une réponse générée comme un fait boutique.",
    source: "Session 05-06/09/2026 — même chantier, correctif « v4 », fichiers assistant.ts + AssistantChat.tsx.",
    expectedCriteria: [
      "vitest run tests/assistant.test.ts passe (dont la priorité current_product_summary et le repli honnête sans ANTHROPIC_API_KEY)",
      "le repli ouvert n'est jamais appelé quand matchIntent() trouve une intention",
      "la réponse du repli ouvert est visuellement distinguée (disclosure) d'une réponse déterministe côté UI",
    ],
  },
  {
    id: "fix_stale_sync_frequency_label",
    category: "debugging",
    description:
      "src/app/(app)/settings/page.tsx affichait en dur « Fréquence : Manuelle (planification non implémentée) » alors qu'un cron Vercel (/api/cron/sync, toutes les 6h) existait déjà et fonctionnait — trouvé en confrontant le texte affiché aux logs Vercel réels plutôt qu'à l'UI seule. Corriger le texte pour refléter l'état réel.",
    source: "claude/ondeal-session-05-09-2026-verification-shopify-secret-audit-stabilite-billing-bug.md (Project OnDeal).",
    expectedCriteria: [
      "le texte affiché correspond exactement au schedule réel déclaré dans vercel.json",
      "aucune autre page de l'app n'affirme un état de synchronisation contredit par les logs de production",
    ],
  },
  {
    id: "github_web_editor_precise_insertion",
    category: "tool_use",
    description:
      "Insérer un paragraphe de 10 lignes exactes dans un fichier .tsx existant via l'éditeur web GitHub (aucun accès git push), sans corrompre l'indentation ni introduire de lignes vides superflues — l'éditeur insère parfois 2 sauts de ligne au lieu d'1 pour un seul caractère \\n tapé.",
    source: "Session 05-06/09/2026 — déploiement de AssistantChat.tsx (fichier 8/10), commit b39b872, vérifié 148 lignes exactes.",
    expectedCriteria: [
      "le nombre de lignes du fichier après commit correspond exactement au compte attendu localement (wc -l)",
      "aucune ligne vide superflue ni indentation incorrecte autour de l'insertion (vérifié via get_page_text/screenshot avant commit)",
    ],
  },

  // --- PHASE 3 (06/09/2026) — Coder Agent : sandbox + navigateur + vision ---
  // Sept tâches, chacune RÉELLEMENT exécutée par le Coder Agent (missions
  // simulées via scripts/simulate-coder-mission.ts, mécanique 100% réelle —
  // seul le modèle est un double scripté, voir ce fichier) contre le dépôt
  // ondeal-intelligence lui-même, jamais inventées après coup.

  {
    id: "coder_inspect_repo_summary",
    category: "code_understanding",
    description:
      "Étape « inspect » du Coder Agent : à partir d'un objectif en langage naturel, créer le workspace isolé de la mission puis localiser les fichiers pertinents du dépôt réel (recherche de \"export default function\" pour construire repoSummary), sans jamais lire un fichier hors du périmètre autorisé.",
    source: "Missions cmtpizwrh00007dwam19wtfr5 / cmtpj38k000007dw08qem1s0k / cmtpjel5c00007du8tocl1sha (06/09/2026), étape 0 « inspect » de src/lib/ai/coder/steps.ts, exécutée via scripts/simulate-coder-mission.ts contre /tmp/ondeal-dev.",
    expectedCriteria: [
      "le step « inspect » se termine SUCCEEDED et produit workspaceRoot + repoSummary non vides",
      "aucun fichier hors de sourceRepoRoot n'est lu (searchCode confiné à root)",
    ],
  },
  {
    id: "coder_generate_a11y_fix_login",
    category: "code_generation",
    description:
      "Étape « edit » du Coder Agent : à partir d'un plan ciblant src/app/login/page.tsx, générer le contenu complet corrigé ajoutant htmlFor/id sur les deux paires <label>/<input> du formulaire de connexion (email, mot de passe) — changement d'accessibilité réel, minimal, réversible.",
    source: "Mission cmtpizwrh00007dwam19wtfr5 (06/09/2026, Run 1) — diff réel vérifié : uniquement 2 attributs htmlFor + 2 attributs id ajoutés, aucune autre ligne touchée.",
    expectedCriteria: [
      "getDiff() après l'étape edit ne modifie QUE src/app/login/page.tsx",
      "le diff n'ajoute que des attributs htmlFor/id, aucune suppression de fonctionnalité",
      "npm run typecheck / lint / test / build passent tous sur le fichier modifié (étape verify_and_fix SUCCEEDED)",
    ],
  },
  {
    id: "coder_fix_loop_injected_syntax_error",
    category: "debugging",
    description:
      "Boucle de correction bornée (§7/§11) : une erreur de syntaxe JSX/TypeScript délibérément injectée (label mal fermé) fait échouer le typecheck de la première tentative (TS1005 « '>' expected »), le Coder Agent appelle son modèle de DEBUG avec le message d'échec réel, applique le correctif, et réussit à la tentative suivante — jamais une boucle illimitée (bornée par security.maxFixIterations).",
    source: "Mission cmtpj38k000007dw08qem1s0k (06/09/2026, Run 2) — iterations[0].reason contient l'erreur tsc réelle, iterations[1].ok === true avec capture d'écran réelle.",
    expectedCriteria: [
      "iterations[0].ok === false avec un message d'erreur tsc réel (jamais un message générique inventé)",
      "iterations[1].ok === true, obtenu après exactement 1 correction (jamais plus que security.maxFixIterations tentatives)",
      "le fichier final est identique au contenu correct connu (comparaison octet-à-octet avec edit1.json)",
    ],
  },
  {
    id: "fix_vision_test_restoreallmocks_vs_clearallmocks",
    category: "test_repair",
    description:
      "tests/coderVision.test.ts échouait sur 4 des 5 tests après le premier (« Cannot read properties of undefined (reading 'map') » dans router.ts::aggregate) : afterEach(() => vi.restoreAllMocks()) réinitialisait aussi l'implémentation mockResolvedValue([]) du mock module-level \"@/lib/db\", pas seulement l'historique d'appels — comportement vitest spécifique à un vi.fn() nu (non issu d'un spy). Corrigé en remplaçant par vi.clearAllMocks(), qui ne touche que l'historique.",
    source: "Session PHASE 3, 06/09/2026 — tests/coderVision.test.ts, fondation Coder Agent (Visual Reviewer).",
    expectedCriteria: [
      "les 5 tests de tests/coderVision.test.ts passent, y compris après le premier test de la suite",
      "le mock \"@/lib/db\" conserve son implémentation mockResolvedValue([]) entre les tests",
    ],
  },
  {
    id: "coder_browser_navigate_login_extract",
    category: "browser_navigation",
    description:
      "Browser Agent réel (Playwright, chromium.launch({headless:true})) : ouvrir la page de preview locale (jamais une URL arbitraire — assertOriginAllowed confiné à l'origine du serveur de preview de la mission), naviguer vers /login, extraire le texte visible, les messages console et les requêtes échouées, puis capturer une capture d'écran PNG pleine page.",
    source: "Missions cmtpizwrh00007dwam19wtfr5 / cmtpj38k000007dw08qem1s0k / cmtpjel5c00007du8tocl1sha (06/09/2026) — étape verify_and_fix, texte visible réel extrait : « ONDEAL INTELLIGENCE / Détectez les problèmes de votre boutique… », 0 message console, 0 requête échouée.",
    expectedCriteria: [
      "getVisibleText() retourne le texte réel du DOM rendu (jamais une valeur simulée)",
      "screenshot() produit un PNG valide et non vide, écrit sur disque comme artefact SCREENSHOT réel",
      "openBrowser() refuse toute origine hors de l'allowlist (assertOriginAllowed)",
    ],
  },
  {
    id: "coder_visual_review_login_screenshot",
    category: "visual_review",
    description:
      "Visual Reviewer (vision.ts) : à partir d'une capture d'écran réelle de /login, produire un rapport structuré (zod) analysant hiérarchie, contraste et mise en page — jamais un verdict généré sans regarder l'image, jamais un jugement inventé si la sortie modèle n'est pas un JSON valide (throw explicite).",
    source: "Session PHASE 3, 06/09/2026 — vision1.json rédigé après inspection RÉELLE de /tmp/mission_proof/probe-screenshot.png : 2 problèmes identifiés (contraste des bordures de champs de saisie ; déséquilibre vertical entre les deux colonnes), overallPass=true (aucun bloquant).",
    expectedCriteria: [
      "reviewScreenshot() lève une erreur explicite si la sortie modèle n'est pas un JSON conforme à VisualCriticReport (jamais un verdict par défaut)",
      "chaque issue rapportée cite une evidence concrète tirée de la capture, jamais une généralité",
      "le modèle utilisé a capabilities().vision === true (refus explicite sinon, voir tests/coderVision.test.ts)",
    ],
  },
  // --- PHASE 4 (06/09/2026) — Supervisor / Storefront Intelligence Engine ---
  // Huit tâches, chacune RÉELLEMENT accomplie par la première mission
  // Storefront (cmtplqkw200007des7ajp1u7p, exécutée via
  // scripts/simulate-storefront-mission.ts, mécanique 100% réelle — graphe
  // persisté en base, VRAIE CoderMission imbriquée cmtplqkz0000b7desdzj49idt
  // — seul le modèle est un double scripté, voir ce script).

  {
    id: "storefront_dynamic_decomposition_login",
    category: "dynamic_decomposition",
    description:
      "À partir d'un objectif de haut niveau (« construire une candidate premium pour /login ») et d'un World State réel (repo, tokens CSS, composants existants), le Supervisor décompose en un GRAPHE de 10 nodes avec dépendances explicites (5 analyses indépendantes → direction créative → synthèse → implémentation → critic → juge) — jamais un plan linéaire codé en dur.",
    source: "Mission cmtplqkw200007des7ajp1u7p (06/09/2026) — plan réellement persisté dans storefront_mission_nodes, 10 lignes, dependsOnJson vérifié cohérent avec l'ordre d'exécution réel observé.",
    expectedCriteria: [
      "les 5 nodes d'analyse (brand/ux/cro/a11y/perf) ont dependsOn=[] et s'exécutent avant tout node qui en dépend",
      "un node dont une dépendance échoue est marqué SKIPPED en cascade, jamais laissé PENDING indéfiniment (aucun deadlock)",
      "le graphe est relu depuis la base (listNodes) et correspond exactement à ce que le plan a produit — jamais une étape silencieusement absente",
    ],
  },
  {
    id: "storefront_brand_bridge_login_card",
    category: "brand_reasoning",
    description:
      "Identifier, à partir du code réel (page.tsx + tokens CSS mesurés), que le panneau marketing de /login porte une identité de marque forte (dégradé --color-accent/--color-warning) alors que la carte de connexion (.auth-card) n'en porte aucune trace visuelle — puis recommander un bridge MINIMAL (fine barre d'accent) plutôt qu'une réécriture complète, cohérent avec la règle « ne pas forcer une esthétique générique ».",
    source: "Node brand_audit, mission cmtplqkw200007des7ajp1u7p — recommandation reprise telle quelle par creative_directions (direction unified_premium_surface) puis par synthesis.",
    expectedCriteria: [
      "la recommandation cite des éléments RÉELS du code (nom de classe CSS, valeur hexadécimale de token) — jamais une généralité sans ancrage",
      "l'implémentation qui en découle (diff réel) ne modifie que .auth-card (aucune autre surface touchée)",
    ],
  },
  {
    id: "storefront_cro_hypothesis_no_fake_metric",
    category: "cro_hypothesis",
    description:
      "Formuler une hypothèse de réduction de friction (rapprocher un signal de confiance existant du point de décision) SANS jamais affirmer un pourcentage d'amélioration de conversion, en citant explicitement l'absence de donnée réelle (real_conversion_rate=INSUFFICIENT_DATA dans le World State) — conformément à la règle « No Fake Metrics ».",
    source: "Node cro_audit, mission cmtplqkw200007des7ajp1u7p.",
    expectedCriteria: [
      "aucun chiffre de conversion (%, taux, nombre) n'apparaît dans data ni findings",
      "uncertainties mentionne explicitement l'absence de mesure réelle disponible",
    ],
  },
  {
    id: "storefront_accessibility_real_contrast_measurement",
    category: "accessibility_measurement",
    description:
      "Calculer RÉELLEMENT (formule de luminance relative WCAG, pas une estimation) le ratio de contraste entre --color-text-faint (#737893) et --color-surface (#131730) utilisés par .auth-social-proof — 4.05:1, sous le seuil AA texte normal (4.5:1) — et recommander le remplacement par --color-text-muted (#a4a9c4, 7.59:1), déjà défini dans le design system, jamais une nouvelle couleur inventée.",
    source: "Node a11y_audit, mission cmtplqkw200007des7ajp1u7p — implémenté tel quel dans le diff réel de globals.css (voir CoderMission cmtplqkz0000b7desdzj49idt), vérifié visuellement sur les captures desktop-1440/mobile-390 réelles.",
    expectedCriteria: [
      "le ratio de contraste rapporté correspond au calcul réel (tolérance ±0.05) à partir des valeurs hexadécimales exactes du design system",
      "le token recommandé en remplacement existe déjà dans :root (jamais une nouvelle variable CSS inventée pour ce correctif)",
    ],
  },
  {
    id: "storefront_synthesize_three_directions",
    category: "multi_strategy_synthesis",
    description:
      "À partir de 3 directions créatives réellement distinctes (pas la même page avec 3 couleurs — trust_anchor / unified_premium_surface / editorial_social_proof_band), évaluer chacune sur des critères explicites et produire une synthèse combinant DEUX directions complémentaires (SYNTHESIZED) tout en rejetant explicitement la troisième avec une raison réelle (risque structurel plus élevé pour un bénéfice incertain) — jamais un choix par défaut sans justification.",
    source: "Nodes creative_directions + synthesis, mission cmtplqkw200007des7ajp1u7p — finalBrief implémenté tel quel (diff réel vérifié : combine exactement la micro-copy de confiance de trust_anchor et la barre d'accent d'unified_premium_surface, aucune trace d'editorial_social_proof_band dans le diff).",
    expectedCriteria: [
      "les 3 directions ont des champs strategy/story/hierarchy/visualPhilosophy/commerceReasoning réellement différents (pas des paraphrases les unes des autres)",
      "la direction rejetée a une raison de rejet réelle et spécifique, jamais une phrase générique",
      "le finalBrief de synthèse se retrouve traçable dans le diff réellement produit par la CoderMission",
    ],
  },
  {
    id: "storefront_adversarial_critic_mandatory_rejection_case",
    category: "adversarial_self_critique",
    description:
      "Même quand le verdict final est PASS, produire un « rejectionCase » réel et spécifique (§38 : « pourquoi cette candidate devrait-elle être rejetée ? ») plutôt qu'un texte de complaisance — ici : absence de toute mesure réelle de bénéfice + revue d'accessibilité limitée à un seul contraste, non une revue complète (clavier/lecteur d'écran).",
    source: "Node critic, mission cmtplqkw200007des7ajp1u7p.",
    expectedCriteria: [
      "rejectionCase est non vide MÊME quand verdict=PASS",
      "rejectionCase cite un risque réel et spécifique à CETTE candidate, jamais une réserve générique applicable à n'importe quelle mission",
    ],
  },
  {
    id: "storefront_independent_judge_scope_boundary",
    category: "independent_verdict",
    description:
      "Décider READY_FOR_RELEASE en distinguant explicitement ce qui bloque une comparaison en preview (aucun blocage réel trouvé) de ce qui bloquerait un déploiement en PRODUCTION réelle (mesure de bénéfice absente, revue a11y non exhaustive) — sans jamais confondre les deux seuils, et sans jamais laisser le Coder Agent s'auto-déclarer en succès (le node coder_implementation ne produit qu'un rapport factuel, jamais un verdict).",
    source: "Node judge, mission cmtplqkw200007des7ajp1u7p — verdict READY_FOR_RELEASE, mission qui s'arrête bien là (aucun déploiement automatique en production, voir graphRunner.ts::runStorefrontMission).",
    expectedCriteria: [
      "le verdict cite explicitement les preuves réellement examinées (evidenceReviewed non générique : diff, typecheck/lint/test/build, revue visuelle, rapport critic)",
      "la mission StorefrontMission se termine SUCCEEDED SANS qu'aucun code ne soit écrit dans le dépôt réel /tmp/ondeal-dev (seul le workspace isolé de la CoderMission est modifié)",
    ],
  },
  {
    id: "storefront_candidate_vs_production_before_after",
    category: "candidate_comparison",
    description:
      "Produire des captures d'écran RÉELLES avant/après à deux largeurs de viewport (desktop 1440px, mobile 390px) du dépôt source inchangé et du workspace de mission déjà buildé, permettant une comparaison visuelle directe candidate-vs-production sans qu'aucune image ne soit une image de substitution.",
    source: "scripts/capture-before-after-screenshots.ts, mission cmtplqkw200007des7ajp1u7p — 4 PNG réels produits et inspectés individuellement (rapport de session).",
    expectedCriteria: [
      "les captures « avant » proviennent d'un build antérieur à l'édition (BUILD_ID horodaté avant la création de la CoderMission)",
      "les captures « après » montrent la barre d'accent et la micro-copy de confiance réellement rendues, sans débordement ni élément cassé",
    ],
  },

  {
    id: "coder_visual_fix_input_contrast_loop",
    category: "visual_fix",
    description:
      "Boucle vision → code complète (§11) : à partir du problème de contraste identifié par le Visual Reviewer sur la première capture (vision1.json), localiser la règle CSS .input dans src/app/globals.css, corriger UNIQUEMENT sa bordure (jamais la variable partagée --color-border-strong, utilisée par d'autres composants — portée minimale), rebuilder, reprévisualiser, reprendre une capture d'écran réelle, et confirmer par une seconde revue visuelle que le problème de contraste a disparu tandis que le déséquilibre vertical (hors scope) persiste à l'identique.",
    source: "Mission cmtpjel5c00007du8tocl1sha (06/09/2026, Run 4) — diff réel : border: 1px solid var(--color-border-strong) → rgba(255,255,255,0.28) sur .input uniquement ; vision2.json rédigé après inspection RÉELLE de la seconde capture (/tmp/mission_proof/probe-screenshot-2.png), confirmant la disparition du problème de contraste.",
    expectedCriteria: [
      "le diff de globals.css ne touche QUE la règle .input (jamais la variable --color-border-strong ni une autre règle)",
      "la seconde revue visuelle ne reporte plus le problème de contraste (comparaison explicite avec vision1.json)",
      "le problème non traité (déséquilibre vertical) est toujours rapporté à l'identique — jamais un rapport « tout est résolu » qui masquerait un problème réel non traité",
    ],
  },
];
