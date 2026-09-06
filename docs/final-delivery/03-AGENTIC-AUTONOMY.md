# 03 — Autonomie et système agentique

## Avertissement de méthode

Aucune affirmation d'AGI, d'ASI, ou de "conscience" n'est faite dans ce document. Ce qui suit mesure précisément ce que le code fait, stage par stage, avec citation `fichier:ligne`.

## La boucle réellement implémentée

Le nom "OBSERVE→UNDERSTAND→REASON→PLAN→DELEGATE→ACT→VERIFY→LEARN→REPLAN" n'existe dans aucun commentaire ni fichier du dépôt (recherche exhaustive, zéro occurrence). Le mandat le nomme comme référence conceptuelle ; voici la correspondance avec le code réel de `src/lib/ai/supervisor/graphRunner.ts`, fonction `runStorefrontMission` (655 lignes) :

| Stage conceptuel | Implémenté ? | Fonction / preuve |
|---|---|---|
| OBSERVE / UNDERSTAND | **Oui** | `buildWorldState(repoRoot)` (`worldState.ts:40`) — lit le dépôt réel (tokens CSS, composants), marque explicitement `INSUFFICIENT_DATA` une donnée externe manquante plutôt que de la simuler. |
| REASON / PLAN | **Oui** | `planInitialGraph()` (`graphRunner.ts:143`) — vrai appel LLM structuré (`callStructuredSpecialist`) qui retourne un graphe de nœuds. `planNodesForInstruction()` (`:193`) re-planifie en conservant le travail déjà fait quand l'Owner ajoute une instruction en cours de mission. |
| DELEGATE / ACT | **Oui** | Boucle principale (`:415-620`) : `partitionRunnable` sélectionne les nœuds exécutables, `claimNode` empêche tout double-traitement, `dispatchSpecialist` ou, pour `coder_implementation`, délégation à une vraie `CoderMission` (`runCoderImplementationNode`). Exécution parallèle des nœuds indépendants (`Promise.all`). |
| VERIFY | **Partiel** | Une étape de vérification distincte n'existe que pour le chemin `coder_implementation` (lecture de `verify_and_fix`/`criticReport.overallPass`, `:296-338`). Pour les autres rôles, le succès/échec du nœud fait office de vérification — pas de stage "juge indépendant" universellement obligatoire depuis la Phase 5 (§178). |
| LEARN | **Oui** | Écriture `MemoryRecord` scope `FAILURE` sur échec de nœud (`:603-609`, best-effort, jamais bloquant), scope `OUTCOME` sur succès de mission (`:645`, `:653`). Le planificateur relit cette mémoire (`recentFailureNotes`/`recentSuccessNotes`, confirmé appelé dans `planInitialGraph` à `:164`). |

## Niveaux d'autonomie — ce qui diffère réellement en code

Valeurs déclarées : `ASSIST`, `AUTONOMOUS`, `DEEP`, `ULTIMATE` (`src/lib/ai/policy/engine.ts:37`).

**Fait vérifié par grep exhaustif** : `autonomyLevel` n'est lu/branché qu'à un seul endroit dans tout le dépôt — `evaluatePolicy()` (`policy/engine.ts:123`) — et cette unique branche ne distingue que `ASSIST` (→ `REQUIRE_APPROVAL` pour `EXTERNAL_READ`) de *tous les autres niveaux* (→ `ALLOW_AUTO`). **`AUTONOMOUS`, `DEEP` et `ULTIMATE` sont strictement identiques en code aujourd'hui.** Le commentaire du schéma (`schema.prisma:907`) reconnaît lui-même que ces niveaux ne devraient "jamais changer le périmètre de capacités, seulement la profondeur de raisonnement/vérification" — mais aucun code implémentant une différence de "profondeur" n'a été trouvé. Ce dossier ne présente donc jamais ces trois niveaux comme différenciés dans son état actuel.

## Composants agentiques vérifiés dans le code

- **Planification multi-étapes / décomposition d'objectif** : réelle — `planInitialGraph` produit un graphe de dépendances avant toute exécution ; le pipeline `coder_implementation` a son propre plan fixe à 5 étapes (inspect→plan→edit→diff→verify_and_fix, `src/lib/ai/coder/steps.ts:14-44`).
- **Orchestration multi-agent** : réelle — 12 rôles fixes (`AVAILABLE_ROLES`, `graphRunner.ts:67-80`), dispatch par `switch`, échec explicite sur rôle inconnu (jamais un skip silencieux).
- **Sélection d'outils** : dispatch de rôle fixe, pas de sélection dynamique par LLM au-delà du rôle assigné par le plan.
- **Exécution** : parallèle pour les nœuds indépendants (`Promise.all`).
- **Retry** : réel à deux niveaux — étapes CoderMission (`maxStepAttempts=3` par défaut, nouvelle ligne `CoderMissionStep` à chaque tentative, jamais écrasée) ; **absent** au niveau des nœuds du graphe (un nœud échoué reste `FAILED`, ses dépendants sont `SKIPPED` en cascade, sans retry automatique).
- **Timeout** : réel — `maxDurationMs` (10 min par défaut) sur `runMissionToCompletion`, `maxWallClockMs` sur le graphe (`graphRunner.ts:476-480`) → `PAUSED`, reprise possible avec le même `missionId`.
- **Budgets** : réels, vérifiés avant ET pendant l'exécution — `SystemPolicy.maxHardBudgetUsdGlobal` (plafond absolu, $20 par défaut, non contournable par un budget de mission), budget par mission (`hardBudgetUsd`), plafond par appel (`ModelConfig.maxCostPerCallUsd`, refusé avant exécution).
- **Arrêt** : kill switch global (pause coopérative à la prochaine itération, jamais une coupure forcée du processus) et annulation par mission (`requestMissionCancellation`, vérifiée en tête de boucle).
- **Reprise** : réelle — une mission `PAUSED` (budget, wall-clock, kill switch) redémarre avec le même `missionId`, réutilise `worldStateJson` déjà construit, ne re-planifie pas depuis zéro.
- **Idempotence** : partielle — les missions sont conçues pour être *reprises*, pas rejouées depuis zéro ; l'instruction Owner en attente est consommée atomiquement (jamais deux fois) ; aucune clé d'idempotence générale n'empêche un effet de bord (ex. PR) d'être dupliqué si une mission déjà `SUCCEEDED` était manuellement relancée — la protection réelle contre ce cas précis vit au niveau `EvolutionProposal` (`coderMissionId` unique en base + approbation humaine), pas au niveau générique des missions.
- **Validation / critique** : réelle pour le chemin coder (TYPECHECK→LINT→TEST→BUILD→PREVIEW→BROWSER→VISION→CRITIC, boucle FIX bornée, revue d'écran par un modèle vision réel).
- **Vérification des résultats** : voir VERIFY ci-dessus — réel uniquement pour le chemin coder_implementation.
- **Mémoire / apprentissage** : réelle, mécanique (rappel par mot-clé, jamais une recherche sémantique par embeddings — explicitement documenté ainsi dans le code).
- **Rollback** : **aucun trouvé** dans tout le dépôt. Sans objet pour le Coder Agent (workspace jetable, jamais le vrai dépôt production). **Absent pour les mutations marchandes réelles** (stock, statut produit) — une fois exécutées côté Shopify, aucun mécanisme de code ne les annule automatiquement.
- **Sandbox vs production** : réelle et double — `PolicyContext.environment` (`SANDBOX_EFFECT` refusé hors SANDBOX) et `SystemPolicy.productionEffectsAllowed` (refusé globalement par défaut, et même activé, jamais `ALLOW_AUTO` — toujours `REQUIRE_APPROVAL`).

## Conclusion mesurée

Le système démontre une planification réelle, une exécution parallèle réelle avec budgets/timeouts/retries partiellement réels, une mémoire réelle mais mécanique, et un mécanisme d'auto-amélioration réel mais structurellement non-autonome (approbation humaine obligatoire pour tout changement de code livré). Il n'y a pas de vérification/critique universelle après chaque action, pas de rollback, et les "niveaux d'autonomie" au-delà d'ASSIST ne sont pas différenciés en code aujourd'hui. C'est un système agentique mesurable et testé — pas une AGI, et ce dossier ne le présente jamais comme tel.
